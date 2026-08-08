"""コース(会場×芝ダ×距離)ごとの「同時期・多年」トラックバイアスプロファイルを算出し、
course_bias_profiles テーブルへ upsert する週次バッチ。

背景・設計思想は supabase/migrations/20260808120000_add_course_bias_profiles.sql のコメント参照。
従来の findBiasReferenceRaces は直近1-2レースの bias_note を拾うだけで参照が薄く確信度が低かった。
このバッチは「実行日の±window_days(季節窓)×直近 years_back 年」の past_performances を会場×芝ダ×距離で
集計し、脚質(前/後)・枠(内/外)のバイアスと、それが複数年で一貫しているか(=確信度)を算出する。
週次で「今の時期」基準に再計算されるため、常に季節(馬場状態)の合ったプロファイルになる。

使い方:
    python compute_course_bias.py --env-file scripts/jvlink/.env.jvlink
    python compute_course_bias.py --env-file .env.local --dry-run
"""

import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5

# 「同時期」とみなす、実行日の前後日数(季節窓)。±3週。
WINDOW_DAYS = 21
# 遡る年数(実行年を含めて years_back+1 年分の同時期を集める)。
YEARS_BACK = 3
# プロファイルを作る最小の延べ出走数(これ未満のコースはサンプル不足で対象外)。
MIN_RUNS_FOR_PROFILE = 60
# 「有利」とラベルする平均着順%差の最小値(方向づけの閾値)。
LABEL_THRESHOLD = 6
# 確信度「高」の条件に使う、より強い差の閾値と最小サンプル。
STRONG_GAP = 8
STRONG_RUNS = 150
MID_RUNS = 80
# 年ごとの一貫性チェックで、その年を1票とみなす最小サンプル。
MIN_YEAR_RUNS = 30


def load_env_file(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _request_json(req: urllib.request.Request, error_context: str) -> list:
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else []
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if e.code < 500 or attempt == MAX_RETRIES:
                raise RuntimeError(f"{error_context}失敗 ({e.code}): {body}") from e
            last_error = e
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == MAX_RETRIES:
                raise RuntimeError(f"{error_context}失敗 (通信エラー): {e}") from e
            last_error = e
        wait = RETRY_BACKOFF_SECONDS * attempt
        print(f"[retry] {error_context}を{wait}秒後に再試行 ({attempt}/{MAX_RETRIES}): {last_error}", file=sys.stderr)
        time.sleep(wait)
    raise AssertionError("unreachable")


class SupabaseClient:
    def __init__(self, url: str, service_role_key: str):
        self.base_url = url.rstrip("/") + "/rest/v1"
        self.key = service_role_key

    def select(self, table: str, params: dict) -> list:
        query = urllib.parse.urlencode(params)
        req = urllib.request.Request(
            f"{self.base_url}/{table}?{query}",
            headers={"apikey": self.key, "Authorization": f"Bearer {self.key}"},
        )
        return _request_json(req, f"{table}への問い合わせ")

    def select_paginated(self, table: str, params: dict, page_size: int = 1000) -> list:
        rows: list = []
        offset = 0
        while True:
            page = self.select(table, dict(params, limit=page_size, offset=offset))
            rows.extend(page)
            if len(page) < page_size:
                break
            offset += page_size
        return rows

    def upsert(self, table: str, rows: list, on_conflict: str) -> None:
        if not rows:
            return
        req = urllib.request.Request(
            f"{self.base_url}/{table}?on_conflict={on_conflict}",
            data=json.dumps(rows).encode("utf-8"),
            method="POST",
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        _request_json(req, f"{table}へのupsert")


CORNER_SPLIT_RE = re.compile(r"[-–]")


def parse_corner_positions(corner_positions):
    if not corner_positions:
        return []
    out = []
    for part in CORNER_SPLIT_RE.split(corner_positions):
        part = part.strip()
        if part.isdigit() and int(part) > 0:
            out.append(int(part))
    return out


def is_front_runner(corner_positions, entry_count):
    """先頭2コーナー平均÷頭数が0.35以下なら前(逃げ・先行)。src/lib/claude/prompts.tsのinferRunningStyle準拠。"""
    positions = parse_corner_positions(corner_positions)
    if not positions:
        return None
    early = positions[:2]
    early_avg = sum(early) / len(early)
    field = entry_count if entry_count and entry_count > 0 else 14
    return (early_avg / field) <= 0.35


def seasonal_date_windows(today: datetime.date, window_days: int, years_back: int):
    """実行日の同時期(±window_days)を、直近 years_back 年分の (lo, hi) 日付範囲リストにして返す。"""
    windows = []
    for y in range(today.year - years_back, today.year + 1):
        try:
            center = today.replace(year=y)
        except ValueError:
            # 2/29 など存在しない日付は前日に丸める
            center = today.replace(year=y, day=today.day - 1)
        lo = center - datetime.timedelta(days=window_days)
        hi = center + datetime.timedelta(days=window_days)
        windows.append((lo.isoformat(), hi.isoformat()))
    return windows


def build_or_filter(windows) -> str:
    """PostgREST の or=() フィルタ文字列を組み立てる。"""
    clauses = [f"and(race_date.gte.{lo},race_date.lte.{hi})" for lo, hi in windows]
    return "(" + ",".join(clauses) + ")"


def fetch_seasonal_rows(client: SupabaseClient, windows) -> list:
    return client.select_paginated(
        "past_performances",
        {
            "or": build_or_filter(windows),
            "finish_position": "gt.0",
            "entry_count": "gt.0",
            "keibajo_code": "not.is.null",
            "track_type": "not.is.null",
            "distance_m": "not.is.null",
            "select": "keibajo_code,keibajo_name,track_type,distance_m,corner_positions,entry_count,finish_position,post_position,race_date",
        },
    )


def _avg(xs):
    return sum(xs) / len(xs) if xs else None


def _pct(x):
    return round(x * 100) if x is not None else None


def classify(gap, runs, years, consistent, front_label, back_label):
    """gap = back_pct - front_pct(正なら front_label 側が有利)。(label, confidence) を返す。"""
    if gap is None:
        return ("フラット", "低")
    if abs(gap) < LABEL_THRESHOLD:
        return ("フラット", "低")
    label = front_label if gap > 0 else back_label
    if runs >= STRONG_RUNS and years >= 2 and abs(gap) >= STRONG_GAP and consistent:
        conf = "高"
    elif runs >= MID_RUNS and abs(gap) >= LABEL_THRESHOLD:
        conf = "中"
    else:
        conf = "低"
    return (label, conf)


def compute_profile(rows: list) -> "dict | None":
    """同一コースの past_performances 行群から1コース分のプロファイルを算出する。"""
    def fin_pct(r):
        return r["finish_position"] / r["entry_count"]

    front, back, inner, outer = [], [], [], []
    # 年ごとの脚質/枠 gap 符号の一貫性チェック用
    per_year = defaultdict(lambda: {"front": [], "back": [], "inner": [], "outer": []})
    for r in rows:
        fp = fin_pct(r)
        yr = r["race_date"][:4]
        is_front = is_front_runner(r.get("corner_positions"), r.get("entry_count"))
        if is_front is True:
            front.append(fp); per_year[yr]["front"].append(fp)
        elif is_front is False:
            back.append(fp); per_year[yr]["back"].append(fp)
        pp = r.get("post_position")
        if pp and pp <= 4:
            inner.append(fp); per_year[yr]["inner"].append(fp)
        elif pp and pp >= 5:
            outer.append(fp); per_year[yr]["outer"].append(fp)

    runs = len(rows)
    if runs < MIN_RUNS_FOR_PROFILE:
        return None
    years = len({r["race_date"][:4] for r in rows})

    front_pct, back_pct = _pct(_avg(front)), _pct(_avg(back))
    inner_pct, outer_pct = _pct(_avg(inner)), _pct(_avg(outer))
    style_gap = (back_pct - front_pct) if (front_pct is not None and back_pct is not None) else None
    waku_gap = (outer_pct - inner_pct) if (inner_pct is not None and outer_pct is not None) else None

    def year_consistent(kind_a, kind_b, pooled_gap):
        """各年(>=MIN_YEAR_RUNS)の gap 符号が pooled と一致するか。"""
        if pooled_gap is None:
            return False
        signs = []
        for yr, d in per_year.items():
            a, b = d[kind_a], d[kind_b]
            if len(a) >= MIN_YEAR_RUNS and len(b) >= MIN_YEAR_RUNS:
                g = _avg(b) * 100 - _avg(a) * 100
                signs.append(1 if g > 0 else -1 if g < 0 else 0)
        if len(signs) < 2:
            return False
        want = 1 if pooled_gap > 0 else -1
        return all(s == want for s in signs)

    style_consistent = year_consistent("front", "back", style_gap)
    waku_consistent = year_consistent("inner", "outer", waku_gap)

    style_label, style_conf = classify(style_gap, len(front) + len(back), years, style_consistent, "前有利", "後方有利")
    waku_label, waku_conf = classify(waku_gap, len(inner) + len(outer), years, waku_consistent, "内枠有利", "外枠有利")

    return {
        "runs": runs,
        "years_covered": years,
        "front_pct": front_pct,
        "back_pct": back_pct,
        "style_gap": style_gap,
        "style_label": style_label,
        "style_confidence": style_conf,
        "inner_pct": inner_pct,
        "outer_pct": outer_pct,
        "waku_gap": waku_gap,
        "waku_label": waku_label,
        "waku_confidence": waku_conf,
        "window_days": WINDOW_DAYS,
    }


def build_summary_note(keibajo_name, track_type, distance_m, p) -> str:
    parts = []
    if p["style_label"] != "フラット":
        parts.append(f"{p['style_label']}(確信度{p['style_confidence']}、先行{p['front_pct']}%/差し{p['back_pct']}%)")
    else:
        parts.append("脚質フラット")
    if p["waku_label"] != "フラット":
        parts.append(f"{p['waku_label']}(確信度{p['waku_confidence']}、内{p['inner_pct']}%/外{p['outer_pct']}%)")
    else:
        parts.append("枠フラット")
    return f"{keibajo_name}{track_type}{distance_m}m 同時期{p['years_covered']}年・n={p['runs']}: " + " / ".join(parts)


JOB_NAME = "compute_course_bias"


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _pipeline_runs_request(method, path, body=None):
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/pipeline_runs{path}",
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        method=method,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"[pipeline_runs] 記録失敗(処理は継続): {e}", file=sys.stderr)
        return None


def start_pipeline_run():
    result = _pipeline_runs_request("POST", "", [{"job_name": JOB_NAME, "status": "running"}])
    return result[0]["id"] if result else None


def finish_pipeline_run(run_id, status, error_message=None):
    if not run_id:
        return
    body = {"status": status, "finished_at": _now_iso()}
    if error_message:
        body["error_message"] = error_message[:2000]
    _pipeline_runs_request("PATCH", f"?id=eq.{run_id}", body)


def main():
    parser = argparse.ArgumentParser(description="コース(会場×芝ダ×距離)ごとの同時期・多年バイアスをcourse_bias_profilesへ算出")
    parser.add_argument("--env-file")
    parser.add_argument("--dry-run", action="store_true", help="計算結果を表示するのみでSupabaseへは書き込まない")
    parser.add_argument("--as-of", help="季節窓の基準日をYYYY-MM-DDで上書き(デフォルトは今日)。検証用")
    args = parser.parse_args()

    if args.env_file:
        load_env_file(args.env_file)
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("環境変数 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。--env-file を指定してください。", file=sys.stderr)
        sys.exit(1)

    today = datetime.date.fromisoformat(args.as_of) if args.as_of else datetime.date.today()
    windows = seasonal_date_windows(today, WINDOW_DAYS, YEARS_BACK)
    client = SupabaseClient(url, key)
    run_id = None if args.dry_run else start_pipeline_run()

    try:
        rows = fetch_seasonal_rows(client, windows)
        print(f"[読み込み] 基準日={today} 季節窓=±{WINDOW_DAYS}日×{YEARS_BACK+1}年 → 対象行={len(rows)}件", file=sys.stderr)

        groups = defaultdict(list)
        name_by_code = {}
        for r in rows:
            key3 = (r["keibajo_code"], r["track_type"], r["distance_m"])
            groups[key3].append(r)
            name_by_code[r["keibajo_code"]] = r.get("keibajo_name") or r["keibajo_code"]

        payloads = []
        skipped = 0
        for (kcode, ttype, dist), grp in groups.items():
            p = compute_profile(grp)
            if p is None:
                skipped += 1
                continue
            note = build_summary_note(name_by_code.get(kcode, kcode), ttype, dist, p)
            payloads.append({"keibajo_code": kcode, "track_type": ttype, "distance_m": dist, "summary_note": note, **p})

        payloads.sort(key=lambda x: (x["keibajo_code"], x["track_type"], x["distance_m"]))
        print(f"[集計] コース数={len(groups)} → プロファイル生成={len(payloads)} (サンプル不足でスキップ={skipped})", file=sys.stderr)

        if args.dry_run:
            for p in payloads:
                print(p["summary_note"])
            print(f"[dry-run] {len(payloads)}件は書き込みをスキップしました", file=sys.stderr)
            return

        client.upsert("course_bias_profiles", payloads, "keibajo_code,track_type,distance_m")
        print(f"[course_bias_profiles] {len(payloads)}件 upsert完了", file=sys.stderr)
        finish_pipeline_run(run_id, "success")
    except Exception as e:
        finish_pipeline_run(run_id, "failed", str(e))
        raise


if __name__ == "__main__":
    main()
