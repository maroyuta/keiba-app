"""診断が出したhonmei/aite推奨(races)を、確定済みの配当(race_payouts)と突き合わせて
的中・回収率を計算し、race_recommendation_resultsへupsertするバッチ。

対象は「honmei_horse_number が設定されている」かつ「race_payoutsに1件以上データがある
(=レースが確定済み)」レース。races.honmei_horse_number等は再診断のたびに上書きされうるため、
実行時点の値をスナップショットとしてrace_recommendation_resultsに保存する
(race_idにunique制約があるためon_conflict=race_idで毎回上書きする設計。再実行しても
その時点のracesの値で再計算されるだけなので、diagnosisが変わっていない限り結果は変わらない)。

集計ロジック:
- bet_type='wide' -> ワイドのみ判定。'umaren' -> 馬連のみ。'both' -> 両方の合算。
- honmei/aiteの2頭の組み合わせを昇順(小さい馬番-大きい馬番)にして
  race_payoutsのcombination(例: "2-12")と突き合わせる(JV-Dataの組番系賭式は昇順で
  格納されている。scripts/jvlink/README.md参照)。
- payout_yenは100円あたりの払戻金なので、実際の払戻額は payout_yen * (stake_yen / 100)。
- 不的中の場合はreturn_yen=0。is_hitは合算return_yenが0より大きいかどうか。

依存はurllib.request等の標準ライブラリのみ(scripts/jvlink/load_to_supabase.pyと同じ方式)。
Node.js環境が無いマシンでもPythonだけで実行できる。

使い方:
    python compute_recommendation_results.py --env-file scripts/jvlink/.env.jvlink
    python compute_recommendation_results.py --env-file .env.local --dry-run
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# 週次の無人実行中に単発のネットワーク瞬断でバッチ全体が落ちる事故を防ぐための設定。
# タイムアウト未設定のurlopenは応答が返らない限り無期限に固まる(2026-07-12、
# netkeibaスクレイパーのfetch()で同種のハングが実際に発生した既知のリスク)。
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5


def load_env_file(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _request_json(req: urllib.request.Request, error_context: str) -> list:
    """timeoutを必ず指定してurlopenし、一時的な失敗(5xx・接続エラー・タイムアウト)は
    指数バックオフで再試行する。4xx等の恒久的エラーは即座に諦める。"""
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

    def upsert(self, table: str, rows: list, on_conflict: str) -> list:
        if not rows:
            return []
        req = urllib.request.Request(
            f"{self.base_url}/{table}?on_conflict={on_conflict}",
            data=json.dumps(rows).encode("utf-8"),
            method="POST",
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=representation",
            },
        )
        return _request_json(req, f"{table}へのupsert")


def combo_key(a: int, b: int) -> str:
    lo, hi = sorted((a, b))
    return f"{lo}-{hi}"


def compute_leg(payouts_by_key: dict, bet_type: str, combo: str, stake_yen: "int | None"):
    """1つの賭式(wide/umaren)について、stake/returnを計算する。stakeが未設定(None/0)ならNone。"""
    if not stake_yen:
        return None
    payout = payouts_by_key.get((bet_type, combo))
    return_yen = round(payout["payout_yen"] * stake_yen / 100) if payout else 0
    return {"stake_yen": stake_yen, "return_yen": return_yen}


def build_result_row(race: dict, payouts: list) -> "dict | None":
    honmei = race.get("honmei_horse_number")
    aite = race.get("aite_horse_number")
    bet_type = race.get("bet_type")
    if honmei is None or aite is None or not bet_type:
        return None

    combo = combo_key(honmei, aite)
    payouts_by_key = {(p["bet_type"], p["combination"]): p for p in payouts}

    legs = []
    if bet_type in ("wide", "both"):
        leg = compute_leg(payouts_by_key, "wide", combo, race.get("bet_amount_wide"))
        if leg:
            legs.append(leg)
    if bet_type in ("umaren", "both"):
        leg = compute_leg(payouts_by_key, "umaren", combo, race.get("bet_amount_umaren"))
        if leg:
            legs.append(leg)

    if not legs:
        # bet_typeはあるがbet_amount_*が両方とも未設定/0 -> 賭けていないので集計対象外
        return None

    stake_yen = sum(leg["stake_yen"] for leg in legs)
    return_yen = sum(leg["return_yen"] for leg in legs)

    return {
        "race_id": race["id"],
        "bet_type": bet_type,
        "honmei_horse_number": honmei,
        "aite_horse_number": aite,
        "stake_yen": stake_yen,
        "is_hit": return_yen > 0,
        "return_yen": return_yen,
        "roi_pct": round(return_yen / stake_yen * 100, 2) if stake_yen else None,
        "race_rank": race.get("race_rank"),
        "computed_at": _now_iso(),
    }


def _now_iso() -> str:
    import datetime

    return datetime.datetime.now(datetime.timezone.utc).isoformat()


JOB_NAME = "compute_recommendation_results"


def _pipeline_runs_request(method: str, path: str, body=None) -> "list | None":
    """pipeline_runsへの状態記録は、Windowsを開かなくてもブラウザの/dashboardから
    週次バッチの成否が分かるようにするための可視化専用の副機能。ここが失敗しても
    バッチ本体の信頼性を落としたくないため、例外は握りつぶしてNoneを返す。"""
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
        description="honmei/aite推奨とrace_payoutsを突き合わせてrace_recommendation_resultsを計算する"
    )
    parser.add_argument("--env-file", help=".env.local等のパス (指定時は環境変数より優先しない)")
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
    # dry-runは手動確認用の実行であり、無人の週次バッチではないため記録対象から外す
    run_id = None if args.dry_run else start_pipeline_run()

    try:
        races = client.select(
            "races",
            {
                "honmei_horse_number": "not.is.null",
                "select": "id,honmei_horse_number,aite_horse_number,bet_type,bet_amount_wide,bet_amount_umaren,race_rank",
            },
        )
        print(f"[読み込み] honmei_horse_number設定済みのrace={len(races)}件", file=sys.stderr)

        race_ids = [r["id"] for r in races]
        payouts_by_race: dict = {rid: [] for rid in race_ids}
        if race_ids:
            # PostgRESTのURL長制限を避けるため、race_idを適当なサイズでチャンクして問い合わせる
            chunk_size = 100
            for i in range(0, len(race_ids), chunk_size):
                chunk = race_ids[i : i + chunk_size]
                rows = client.select(
                    "race_payouts",
                    {
                        "race_id": f"in.({','.join(chunk)})",
                        "bet_type": "in.(wide,umaren)",
                        "select": "race_id,bet_type,combination,payout_yen",
                    },
                )
                for row in rows:
                    payouts_by_race[row["race_id"]].append(row)

        result_rows = []
        skipped_no_payout = 0
        skipped_no_bet = 0
        for race in races:
            payouts = payouts_by_race.get(race["id"], [])
            if not payouts:
                skipped_no_payout += 1
                continue
            row = build_result_row(race, payouts)
            if row is None:
                skipped_no_bet += 1
                continue
            result_rows.append(row)

        print(
            f"[集計] 対象={len(result_rows)}件 "
            f"(未確定でスキップ={skipped_no_payout}, 賭け目未設定でスキップ={skipped_no_bet})",
            file=sys.stderr,
        )

        if args.dry_run:
            for row in result_rows:
                print(json.dumps(row, ensure_ascii=False))
            print("[dry-run] Supabaseへの書き込みはスキップしました", file=sys.stderr)
            return

        results = client.upsert("race_recommendation_results", result_rows, on_conflict="race_id")
        print(f"[race_recommendation_results] {len(results)}件 upsert完了", file=sys.stderr)
        finish_pipeline_run(run_id, "success")
    except Exception as e:
        finish_pipeline_run(run_id, "failed", str(e))
        raise


if __name__ == "__main__":
    main()
