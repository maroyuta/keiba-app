"""確定済みレースについて、race_entries(post_position×finish_position)と
past_performances(corner_positions由来の脚質・pace_mark)から実況トラックバイアスを
機械集計し、races.actual_bias_noteへ書き込むバッチ。

背景: races.actual_bias_note列は2026-08-01に一度だけ手動SQLで単純な枠(post_position)集計を
書き込んだ実績があり、その後さらに別セッションが「[実測v2] ...」という脚質(先行/後方)・
pace_mark込みの手動SQLでリッチな書式に上書きしていた(いずれもgit管理下のコードとしては
存在しない、その場限りのSupabase MCP直叩き)。AGENTS.mdには「自動計算の仕組みは無い、
今後の課題」と記録されたまま放置されていたため、その"実測v2"書式を恒久的なバッチとして
実装した(2026-08-04)。

集計ロジック:
- 枠: race_entries.post_position(1-4 vs 5-8)×finish_position/entry_countの平均。
- 脚質: past_performances.corner_positions(例 "3-3-2-2")とentry_countから、
  src/lib/claude/prompts.tsのinferRunningStyle()と同じロジックで先頭2コーナー平均÷頭数を
  算出し、0.35以下を「前」(逃げ・先行)、それ超を「後方」(差し・追込)に二分して
  finish_position/entry_countの平均を比較する。past_performancesは「後に再度出走した馬」
  のみ遡って埋まる設計のため、対象レースの馬の一部にしか無いことが多い(カバレッジ次第で
  この項目自体を省略する)。
- pace: past_performances.pace_mark(レース全体のH/M/S、対象レースの行なら全馬同じ値のはず)
  を多数決で採用。全て空ならpace表記を省略する。
- 有利/フラットの閾値は前後差・内外差ともに10ポイント(平均着順%の差)。この数字はAGENTS.mdの
  過去の手動判定例を大まかに踏襲したもので、統計的検定ではなく実用上の目安。

対象: race_entries.finish_position(>0)が入っている頭数が、races.entry_countの80%以上に
達しているレース(取消・除外が数頭あっても集計対象にする一方、大量欠損の未確定レースは除外)。
デフォルトはactual_bias_noteが未設定(null)のレースのみを対象にする(確定後の着順は変わらない
前提の差分実行、--recompute-allで全件強制再計算も可能)。

依存はurllib.request等の標準ライブラリのみ(scripts/jvlink/load_to_supabase.pyと同じ方式)。

使い方:
    python compute_actual_bias.py --env-file scripts/jvlink/.env.jvlink
    python compute_actual_bias.py --env-file .env.local --dry-run
    python compute_actual_bias.py --env-file .env.local --recompute-all
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
from collections import Counter

REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5

# 前/後方・内枠/外枠の「有利」と呼ぶための平均着順%の最小差(ポイント)。これ未満はフラット表記。
BIAS_THRESHOLD_POINTS = 10
# 対象レースとみなす最小確定率(entry_countに対するfinish_position>0の割合)
MIN_CONFIRMED_RATIO = 0.8


def load_env_file(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _request_json(req: urllib.request.Request, error_context: str) -> list:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
                return json.loads(resp.read().decode("utf-8"))
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
        print(
            f"[retry] {error_context}を{wait}秒後に再試行します ({attempt}/{MAX_RETRIES}回目): {last_error}",
            file=sys.stderr,
        )
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
        """PostgRESTはデフォルトで1レスポンスあたりの行数に上限(このプロジェクトでは1000件)が
        あり、素朴にselect()を呼ぶと超過分が黙って切り捨てられる(2026-08-04、race_entries/
        past_performancesを100レース分まとめて問い合わせた際に実際に踏んだ既知のバグ。
        1レースあたり15〜18行あるため100レース分だと簡単に1000件を超える)。
        limit/offsetでpage_size件ずつ、レスポンスがpage_size未満になるまで取得し続ける。"""
        rows: list = []
        offset = 0
        while True:
            page_params = dict(params, limit=page_size, offset=offset)
            page = self.select(table, page_params)
            rows.extend(page)
            if len(page) < page_size:
                break
            offset += page_size
        return rows

    def update(self, table: str, filters: dict, body: dict) -> list:
        query = urllib.parse.urlencode(filters)
        req = urllib.request.Request(
            f"{self.base_url}/{table}?{query}",
            data=json.dumps(body).encode("utf-8"),
            method="PATCH",
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
        )
        return _request_json(req, f"{table}への更新")


# src/lib/claude/prompts.tsのparseCornerPositions/inferRunningStyleと同じロジックのPython移植。
CORNER_SPLIT_RE = re.compile(r"[-–]")


def parse_corner_positions(corner_positions: "str | None") -> list:
    if not corner_positions:
        return []
    positions = []
    for part in CORNER_SPLIT_RE.split(corner_positions):
        part = part.strip()
        if part.isdigit() and int(part) > 0:
            positions.append(int(part))
    return positions


def is_front_runner(corner_positions: "str | None", entry_count: "int | None") -> "bool | None":
    """先頭2コーナー平均÷頭数が0.35以下なら「前」(逃げ・先行)、それ超なら「後方」(差し・追込)。
    corner_positionsが無ければNone(判定不能)。"""
    positions = parse_corner_positions(corner_positions)
    if not positions:
        return None
    early = positions[:2]
    early_avg = sum(early) / len(early)
    field = entry_count if entry_count and entry_count > 0 else 14
    ratio = early_avg / field
    return ratio <= 0.35


def fetch_confirmed_races(client: SupabaseClient, recompute_all: bool) -> list:
    params = {
        "entry_count": "not.is.null",
        "select": "id,race_date,keibajo_name,race_number,track_type,distance_m,entry_count,actual_bias_note",
        "order": "race_date.desc",
    }
    if not recompute_all:
        params["actual_bias_note"] = "is.null"
    return client.select_paginated("races", params)


def fetch_entries_by_race(client: SupabaseClient, race_ids: list) -> dict:
    entries_by_race: dict = {rid: [] for rid in race_ids}
    # レースあたり最大18頭程度いるため、chunk_sizeは1000件上限(select_paginated参照)を
    # 大きく下回る値にして、ページング分岐に頼りきらず素直に収まるようにする。
    chunk_size = 40
    for i in range(0, len(race_ids), chunk_size):
        chunk = race_ids[i : i + chunk_size]
        rows = client.select_paginated(
            "race_entries",
            {
                "race_id": f"in.({','.join(chunk)})",
                "finish_position": "not.is.null",
                "select": "race_id,post_position,horse_number,finish_position",
            },
        )
        for row in rows:
            entries_by_race[row["race_id"]].append(row)
    return entries_by_race


def fetch_past_performances_by_race(client: SupabaseClient, race_ids: list) -> dict:
    pp_by_race: dict = {rid: [] for rid in race_ids}
    chunk_size = 40
    for i in range(0, len(race_ids), chunk_size):
        chunk = race_ids[i : i + chunk_size]
        rows = client.select_paginated(
            "past_performances",
            {
                "race_id": f"in.({','.join(chunk)})",
                "select": "race_id,corner_positions,pace_mark,finish_position,entry_count",
            },
        )
        for row in rows:
            pp_by_race[row["race_id"]].append(row)
    return pp_by_race


def build_bias_note(race: dict, entries: list, pp_rows: list) -> "str | None":
    entry_count = race["entry_count"]
    confirmed = [e for e in entries if e.get("finish_position") and e["finish_position"] > 0]
    if entry_count <= 0 or len(confirmed) < entry_count * MIN_CONFIRMED_RATIO:
        return None
    if len(confirmed) < 3:
        return None

    def ratio(e: dict) -> float:
        return e["finish_position"] / entry_count

    inner = [ratio(e) for e in confirmed if e.get("post_position") and e["post_position"] <= 4]
    outer = [ratio(e) for e in confirmed if e.get("post_position") and e["post_position"] >= 5]

    waku_part = None
    if inner and outer:
        inner_pct = round(sum(inner) / len(inner) * 100)
        outer_pct = round(sum(outer) / len(outer) * 100)
        diff = inner_pct - outer_pct
        if diff >= BIAS_THRESHOLD_POINTS:
            label = "外枠有利"
        elif diff <= -BIAS_THRESHOLD_POINTS:
            label = "内枠有利"
        else:
            label = "枠フラット"
        waku_part = f"{label}(内枠{inner_pct}% vs 外枠{outer_pct}%)"

    front_ratios = []
    back_ratios = []
    for pp in pp_rows:
        fp = pp.get("finish_position")
        if not fp or fp <= 0:
            continue
        front = is_front_runner(pp.get("corner_positions"), pp.get("entry_count") or entry_count)
        if front is None:
            continue
        r = fp / (pp.get("entry_count") or entry_count)
        (front_ratios if front else back_ratios).append(r)

    style_part = None
    if len(front_ratios) >= 2 and len(back_ratios) >= 2:
        front_pct = round(sum(front_ratios) / len(front_ratios) * 100)
        back_pct = round(sum(back_ratios) / len(back_ratios) * 100)
        diff = front_pct - back_pct
        if diff <= -BIAS_THRESHOLD_POINTS:
            label = "前有利"
        elif diff >= BIAS_THRESHOLD_POINTS:
            label = "後方有利"
        else:
            label = "脚質フラット"
        style_part = f"{label}(先行勢の平均着順{front_pct}% vs 後方勢{back_pct}%)"

    pace_counter = Counter(pp["pace_mark"] for pp in pp_rows if pp.get("pace_mark"))
    pace_part = f"[pace:{pace_counter.most_common(1)[0][0]}]" if pace_counter else None

    if waku_part is None and style_part is None:
        return None

    parts = [p for p in (style_part, waku_part) if p]
    note = f"[実測] {' / '.join(parts)} {entry_count}頭"
    if pace_part:
        note += f" {pace_part}"
    note += "(post_position×finish_positionの機械集計。脚質は past_performances のcorner_positions由来、対象馬のみ)"
    return note


JOB_NAME = "compute_actual_bias"


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _pipeline_runs_request(method: str, path: str, body=None) -> "list | None":
    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        return None
    req = urllib.request.Request(
        f"{supabase_url.rstrip('/')}/rest/v1/pipeline_runs{path}",
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        method=method,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"[pipeline_runs] 記録に失敗しましたが処理は継続します: {e}", file=sys.stderr)
        return None


def start_pipeline_run() -> "str | None":
    result = _pipeline_runs_request("POST", "", [{"job_name": JOB_NAME, "status": "running"}])
    return result[0]["id"] if result else None


def finish_pipeline_run(run_id: "str | None", status: str, error_message: "str | None" = None) -> None:
    if not run_id:
        return
    body = {"status": status, "finished_at": _now_iso()}
    if error_message:
        body["error_message"] = error_message[:2000]
    _pipeline_runs_request("PATCH", f"?id=eq.{run_id}", body)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="確定済みレースのpost_position/finish_positionと脚質から実況トラックバイアスを集計しraces.actual_bias_noteへ書き込む"
    )
    parser.add_argument("--env-file", help=".env.local等のパス (指定時は環境変数より優先しない)")
    parser.add_argument(
        "--recompute-all", action="store_true",
        help="actual_bias_note設定済みのレースも含め全確定レースを再計算する(通常は未設定のレースのみ)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="計算結果を表示するのみでSupabaseへは書き込まない"
    )
    args = parser.parse_args()

    if args.env_file:
        load_env_file(args.env_file)

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print(
            "環境変数 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。"
            " --env-file .env.local のように指定するか、事前にexportしてください。",
            file=sys.stderr,
        )
        sys.exit(1)

    client = SupabaseClient(supabase_url, service_key)
    run_id = None if args.dry_run else start_pipeline_run()

    try:
        races = fetch_confirmed_races(client, args.recompute_all)
        print(f"[読み込み] 対象候補race={len(races)}件 (recompute_all={args.recompute_all})", file=sys.stderr)

        race_ids = [r["id"] for r in races]
        entries_by_race = fetch_entries_by_race(client, race_ids)
        pp_by_race = fetch_past_performances_by_race(client, race_ids)

        updated = 0
        skipped_unconfirmed = 0
        skipped_no_signal = 0
        for race in races:
            note = build_bias_note(race, entries_by_race.get(race["id"], []), pp_by_race.get(race["id"], []))
            if note is None:
                entries = entries_by_race.get(race["id"], [])
                confirmed = [e for e in entries if e.get("finish_position") and e["finish_position"] > 0]
                if race["entry_count"] and len(confirmed) < race["entry_count"] * MIN_CONFIRMED_RATIO:
                    skipped_unconfirmed += 1
                else:
                    skipped_no_signal += 1
                continue
            if args.dry_run:
                print(f"{race['race_date']} {race['keibajo_name']}{race['race_number']}R: {note}")
            else:
                client.update("races", {"id": f"eq.{race['id']}"}, {"actual_bias_note": note})
            updated += 1

        print(
            f"[actual_bias_note] {updated}件 {'表示' if args.dry_run else '更新'}完了 "
            f"(未確定でスキップ={skipped_unconfirmed}, 判定材料不足でスキップ={skipped_no_signal})",
            file=sys.stderr,
        )
        if not args.dry_run:
            finish_pipeline_run(run_id, "success")
    except Exception as e:
        finish_pipeline_run(run_id, "failed", str(e))
        raise


if __name__ == "__main__":
    main()
