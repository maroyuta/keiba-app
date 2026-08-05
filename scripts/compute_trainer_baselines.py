"""training_sessions.trainer_name × training_typeでグルーピングし、その厩舎の坂路/ウッドチップ
総合タイム(total_time_sec)の平均・標準偏差をtrainer_training_baselinesへ書き込むバッチ
(2026-08-05新設)。

AGENTS.mdの「調教評価の設計方針」(絶対タイムでの閾値判定はしない、厩舎単位の相対比較が基本)を
実現するためのベースラインで、training_sessions再設計時(20260710070000)から「次回以降の課題」
として積み残されていたもの。区間タイム自体が2026-08-05に確定するまで作りようが無かった。

サンプルサイズ5未満の厩舎は対象外(平均・標準偏差が意味を持たないため)。

使い方:
    python compute_trainer_baselines.py --env-file scripts/jvlink/.env.jvlink
    python compute_trainer_baselines.py --env-file .env.local --dry-run
"""

import argparse
import datetime
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5
MIN_SAMPLE_SIZE = 5


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
        print(f"[retry] {error_context}を{wait}秒後に再試行します: {last_error}", file=sys.stderr)
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
        """Prefer: return=minimalで204(空ボディ)が返るため、_request_json(JSON前提)は使わない。"""
        if not rows:
            return
        batch_size = 500
        for i in range(0, len(rows), batch_size):
            batch = rows[i : i + batch_size]
            req = urllib.request.Request(
                f"{self.base_url}/{table}?on_conflict={on_conflict}",
                data=json.dumps(batch).encode("utf-8"),
                method="POST",
                headers={
                    "apikey": self.key,
                    "Authorization": f"Bearer {self.key}",
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates,return=minimal",
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
                        raise RuntimeError(f"{table}へのupsert失敗 ({e.code}): {body}") from e
                    last_error = e
                except (urllib.error.URLError, TimeoutError) as e:
                    if attempt == MAX_RETRIES:
                        raise RuntimeError(f"{table}へのupsert失敗 (通信エラー): {e}") from e
                    last_error = e
                wait = RETRY_BACKOFF_SECONDS * attempt
                print(f"[retry] {table}へのupsertを{wait}秒後に再試行します: {last_error}", file=sys.stderr)
                time.sleep(wait)


JOB_NAME = "compute_trainer_baselines"


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
    parser = argparse.ArgumentParser(description="training_sessionsから厩舎単位の坂路タイムベースラインを計算する")
    parser.add_argument("--env-file", help=".env.local等のパス")
    parser.add_argument("--dry-run", action="store_true", help="計算結果を表示するのみでSupabaseへは書き込まない")
    args = parser.parse_args()

    if args.env_file:
        load_env_file(args.env_file)

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print("環境変数 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。", file=sys.stderr)
        sys.exit(1)

    client = SupabaseClient(supabase_url, service_key)
    run_id = None if args.dry_run else start_pipeline_run()

    try:
        rows = client.select_paginated(
            "training_sessions",
            {
                "select": "trainer_name,training_type,total_time_sec",
                "trainer_name": "not.is.null",
                "total_time_sec": "not.is.null",
            },
        )
        print(f"[読み込み] training_sessions(trainer_name/total_time_sec設定済み)={len(rows)}件", file=sys.stderr)

        groups: dict = defaultdict(list)
        for r in rows:
            groups[(r["trainer_name"], r["training_type"])].append(float(r["total_time_sec"]))

        baseline_rows = []
        skipped_small = 0
        for (trainer_name, training_type), times in groups.items():
            n = len(times)
            if n < MIN_SAMPLE_SIZE:
                skipped_small += 1
                continue
            avg = sum(times) / n
            variance = sum((t - avg) ** 2 for t in times) / n
            stddev = math.sqrt(variance)
            baseline_rows.append(
                {
                    "trainer_name": trainer_name,
                    "training_type": training_type,
                    "sample_size": n,
                    "avg_total_time_sec": round(avg, 2),
                    "stddev_total_time_sec": round(stddev, 2),
                    "computed_at": _now_iso(),
                }
            )

        print(
            f"[集計] 厩舎×種別グループ={len(groups)}件 (5件未満でスキップ={skipped_small}), "
            f"対象={len(baseline_rows)}件",
            file=sys.stderr,
        )

        if args.dry_run:
            print(f"[dry-run] trainer_training_baselines {len(baseline_rows)}件を書き込む予定(スキップ)", file=sys.stderr)
            for r in baseline_rows[:5]:
                print(json.dumps(r, ensure_ascii=False))
            return

        client.upsert("trainer_training_baselines", baseline_rows, on_conflict="trainer_name,training_type")
        print(f"[trainer_training_baselines] {len(baseline_rows)}件 upsert完了", file=sys.stderr)
        finish_pipeline_run(run_id, "success")
    except Exception as e:
        finish_pipeline_run(run_id, "failed", str(e))
        raise


if __name__ == "__main__":
    main()
