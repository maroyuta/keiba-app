"""past_performances自体を(race_date, keibajo_name, race_number)でグルーピングし、
レース単位の実況トラックバイアス(枠・脚質)を算出した上で、各馬がそのバイアスの
恩恵を受けたか逆風を受けたかの判定まで含めてpast_performances.bias_noteへ書き込むバッチ。

scripts/jvlink/compute_actual_bias.pyがraces/race_entries(JV-Link由来、確定レースのみ)を
使うのに対し、こちらはpast_performances自体(netkeiba由来、馬の過去走履歴として蓄積された分)を
自己結合して集計する。races/race_entriesにまだ同期されていない(=JV-Link側の対象期間外の)
古いレースもpast_performancesには残っているため、こちらの方がカバレッジが広い
(2026-08-05時点の実データで、races経由は約16%しかマッチしなかったのに対し、
past_performances自己結合なら66%(54,164/81,700件)をカバーできることを確認済み)。

集計ロジック(compute_actual_bias.pyと同じ考え方):
- 枠: post_position(1-4 vs 5-8)×finish_position/entry_countの平均。
- 脚質: corner_positions(先頭2コーナー平均÷頭数)から前(逃げ・先行)/後方(差し・追込)を判定し、
  finish_position/entry_countの平均を比較する(src/lib/claude/prompts.tsのinferRunningStyleと
  同じロジック)。
- 有利/フラットの閾値はcompute_actual_bias.pyと同じ10ポイント。

★このバッチの新規ポイント: レース単位のバイアス方向が決まったら、各past_performances行
(=1頭のその時の枠・脚質)がバイアスの有利側だったか不利側だったかを判定し、
「この馬はバイアス有利/不利/影響軽微だった」という一言をbias_noteの末尾に追記する。
枠・脚質のどちらもプラスなら有利、どちらもマイナスなら不利、片方ずつなら影響混在、
バイアス自体がフラットならその軸は判定に含めない(有利でも不利でもないため0点扱い)。

対象: 同じ(race_date, keibajo_name, race_number)の組でpost_position・finish_position
(>0)が揃っている行が5件以上あるグループのみ(サンプル不足のグループは対象外)。
デフォルトではbias_noteが未設定(null)の行のみ処理する(--recompute-allで全件強制再計算)。

使い方:
    python compute_past_performance_bias.py --env-file scripts/jvlink/.env.jvlink
    python compute_past_performance_bias.py --env-file .env.local --dry-run
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
from collections import Counter, defaultdict

REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5

BIAS_THRESHOLD_POINTS = 10
MIN_GROUP_SIZE = 5


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
        """PostgRESTのデフォルト行数上限(このプロジェクトでは1000件)による無言の切り捨てを
        避けるため、limit/offsetでpage_size件ずつ取得し続ける
        (2026-08-04、scripts/jvlink/compute_actual_bias.pyで実際に踏んだバグと同じ対策)。"""
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

    def rpc_bulk_update_bias_note(self, updates: list, batch_size: int = 2000) -> None:
        """bulk_update_past_performance_bias RPC(20260805020000マイグレーション参照)を
        バッチ呼び出しする。id指定のUPDATEのみなので、upsert(POST+on_conflict)と違い
        他列に触れず安全(2026-08-05、upsertがNOT NULL違反で失敗した問題の対策)。
        関数がvoidを返すためレスポンスボディが空(204)になりうるので、_request_json
        (JSON前提)は使わずここで個別にリクエストする。"""
        for i in range(0, len(updates), batch_size):
            batch = updates[i : i + batch_size]
            req = urllib.request.Request(
                f"{self.base_url}/rpc/bulk_update_past_performance_bias",
                data=json.dumps({"updates": batch}).encode("utf-8"),
                method="POST",
                headers={
                    "apikey": self.key,
                    "Authorization": f"Bearer {self.key}",
                    "Content-Type": "application/json",
                },
            )
            last_error: Exception | None = None
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
                        resp.read()
                    break
                except urllib.error.HTTPError as e:
                    body = e.read().decode("utf-8", errors="replace")
                    if e.code < 500 or attempt == MAX_RETRIES:
                        raise RuntimeError(f"bulk_update_past_performance_bias RPC失敗 ({e.code}): {body}") from e
                    last_error = e
                except (urllib.error.URLError, TimeoutError) as e:
                    if attempt == MAX_RETRIES:
                        raise RuntimeError(f"bulk_update_past_performance_bias RPC失敗 (通信エラー): {e}") from e
                    last_error = e
                wait = RETRY_BACKOFF_SECONDS * attempt
                print(f"[retry] RPC呼び出しを{wait}秒後に再試行します: {last_error}", file=sys.stderr)
                time.sleep(wait)


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
    src/lib/claude/prompts.tsのinferRunningStyleと同じ判定ロジック。"""
    positions = parse_corner_positions(corner_positions)
    if not positions:
        return None
    early = positions[:2]
    early_avg = sum(early) / len(early)
    field = entry_count if entry_count and entry_count > 0 else 14
    ratio = early_avg / field
    return ratio <= 0.35


def fetch_target_rows(client: SupabaseClient, recompute_all: bool) -> list:
    params = {
        "post_position": "not.is.null",
        "finish_position": "not.is.null",
        "entry_count": "not.is.null",
        "race_date": "not.is.null",
        "keibajo_name": "not.is.null",
        "race_number": "not.is.null",
        "select": "id,race_date,keibajo_name,race_number,post_position,finish_position,entry_count,corner_positions,pace_mark,bias_note",
    }
    if not recompute_all:
        params["bias_note"] = "is.null"
    return client.select_paginated("past_performances", params)


def label_and_direction(favored_pct_diff: float) -> "tuple[str, int]":
    """favored_pct_diff = inner_or_front_pct - outer_or_back_pct。プラスが大きいほど
    内枠/前が不利(平均着順比が悪い=数値が大きい)なので、符号に注意。
    戻り値: (ラベル, 内枠/前が有利なら+1・外枠/後方が有利なら-1・フラットなら0)"""
    if favored_pct_diff >= BIAS_THRESHOLD_POINTS:
        return "外", -1
    if favored_pct_diff <= -BIAS_THRESHOLD_POINTS:
        return "内", 1
    return "フラット", 0


def build_group_bias(rows: list) -> "dict | None":
    """1レース分(同一race_date/keibajo_name/race_number)のpast_performances行から
    枠・脚質のバイアス方向を集計する。"""

    def ratio(r: dict) -> float:
        return r["finish_position"] / r["entry_count"]

    inner = [ratio(r) for r in rows if r["post_position"] <= 4]
    outer = [ratio(r) for r in rows if r["post_position"] >= 5]
    waku_label = "枠フラット"
    waku_dir = 0
    if inner and outer:
        inner_pct = round(sum(inner) / len(inner) * 100)
        outer_pct = round(sum(outer) / len(outer) * 100)
        side, waku_dir = label_and_direction(inner_pct - outer_pct)
        waku_label = f"{'内枠有利' if side == '内' else '外枠有利' if side == '外' else '枠フラット'}(内枠{inner_pct}% vs 外枠{outer_pct}%)"

    front_ratios, back_ratios = [], []
    front_flag_by_id = {}
    for r in rows:
        front = is_front_runner(r.get("corner_positions"), r["entry_count"])
        front_flag_by_id[r["id"]] = front
        if front is None:
            continue
        (front_ratios if front else back_ratios).append(ratio(r))

    style_label = "脚質フラット"
    style_dir = 0
    if len(front_ratios) >= 2 and len(back_ratios) >= 2:
        front_pct = round(sum(front_ratios) / len(front_ratios) * 100)
        back_pct = round(sum(back_ratios) / len(back_ratios) * 100)
        side, style_dir = label_and_direction(front_pct - back_pct)
        # label_and_directionは枠(内/外)の語彙なので脚質用に読み替える
        style_label = f"{'前有利' if side == '内' else '後方有利' if side == '外' else '脚質フラット'}(先行勢の平均着順{front_pct}% vs 後方勢{back_pct}%)"

    pace_counter = Counter(r["pace_mark"] for r in rows if r.get("pace_mark"))
    pace_part = f" [pace:{pace_counter.most_common(1)[0][0]}]" if pace_counter else ""

    return {
        "waku_label": waku_label,
        "waku_dir": waku_dir,
        "style_label": style_label,
        "style_dir": style_dir,
        "pace_part": pace_part,
        "n": len(rows),
        "front_flag_by_id": front_flag_by_id,
    }


def build_row_note(group_bias: dict, row: dict) -> str:
    race_summary = (
        f"[実況] {group_bias['style_label']} / {group_bias['waku_label']} "
        f"{group_bias['n']}頭{group_bias['pace_part']}"
    )

    # この馬自身の枠・脚質が、有利側(+1)/不利側(-1)/バイアス自体フラット(0)のどれに乗るか
    horse_waku_dir = 1 if row["post_position"] <= 4 else -1
    fit_score = horse_waku_dir * group_bias["waku_dir"]  # 一致(有利)なら+1、逆(不利)なら-1、バイアスがフラット(0)なら0

    front = group_bias["front_flag_by_id"].get(row["id"])
    style_fit = 0
    if front is not None and group_bias["style_dir"] != 0:
        horse_style_dir = 1 if front else -1
        style_fit = horse_style_dir * group_bias["style_dir"]

    total_fit = fit_score + style_fit
    if group_bias["waku_dir"] == 0 and group_bias["style_dir"] == 0:
        verdict = None  # レース自体がバイアスフラットなので個別馬の判定はしない
    elif total_fit > 0:
        verdict = "バイアス有利だった中での結果"
    elif total_fit < 0:
        verdict = "バイアス不利だった中での結果"
    else:
        verdict = "バイアスの影響は混在(枠・脚質で有利不利が相殺)"

    if verdict is None:
        return race_summary
    return f"{race_summary} → この馬は{verdict}"


JOB_NAME = "compute_past_performance_bias"


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
        description="past_performancesを自己結合してレース単位の実況バイアス+馬ごとの有利不利判定をbias_noteへ書き込む"
    )
    parser.add_argument("--env-file", help=".env.local等のパス (指定時は環境変数より優先しない)")
    parser.add_argument(
        "--recompute-all", action="store_true",
        help="bias_note設定済みの行も含め全件再計算する(通常は未設定の行のみ)",
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
        rows = fetch_target_rows(client, args.recompute_all)
        print(f"[読み込み] 対象候補行={len(rows)}件 (recompute_all={args.recompute_all})", file=sys.stderr)

        groups: dict = defaultdict(list)
        for r in rows:
            key = (r["race_date"], r["keibajo_name"], r["race_number"])
            groups[key].append(r)

        update_payloads = []
        skipped_small_group = 0
        for key, group_rows in groups.items():
            if len(group_rows) < MIN_GROUP_SIZE:
                skipped_small_group += len(group_rows)
                continue
            group_bias = build_group_bias(group_rows)
            for row in group_rows:
                note = build_row_note(group_bias, row)
                update_payloads.append({"id": row["id"], "bias_note": note})

        print(
            f"[集計] レースグループ={len(groups)}件 (5頭未満でスキップ={skipped_small_group}行), "
            f"更新対象={len(update_payloads)}行",
            file=sys.stderr,
        )

        if args.dry_run:
            for p in update_payloads[:20]:
                print(json.dumps(p, ensure_ascii=False))
            print(f"[dry-run] 以下{len(update_payloads)}件はSupabaseへの書き込みをスキップしました", file=sys.stderr)
            return

        client.rpc_bulk_update_bias_note(update_payloads)
        print(f"[past_performances.bias_note] {len(update_payloads)}件 更新完了", file=sys.stderr)
        finish_pipeline_run(run_id, "success")
    except Exception as e:
        finish_pipeline_run(run_id, "failed", str(e))
        raise


if __name__ == "__main__":
    main()
