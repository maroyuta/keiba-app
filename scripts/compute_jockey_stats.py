"""past_performances.jockey_nameを集計し、騎手のコース/馬場/距離帯別成績+単勝回収率を
計算してjockey_statsへ書き込むバッチ(2026-08-05新設、sire_stats/nick_statsと同じ設計)。

ROI計算(単勝100円均等賭けシミュレーション):
roi_win_pct = (的中時のodds_winの合計 ÷ starts) × 100

使い方:
    python compute_jockey_stats.py --env-file scripts/jvlink/.env.jvlink
    python compute_jockey_stats.py --env-file .env.local --dry-run
"""

import argparse
import datetime
import json
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
DATA_SOURCE = "self_computed_past_performances"

DISTANCE_BANDS = [
    (0, 1200, "1200以下"),
    (1201, 1400, "1201-1400"),
    (1401, 1600, "1401-1600"),
    (1601, 1800, "1601-1800"),
    (1801, 2000, "1801-2000"),
    (2001, 2400, "2001-2400"),
    (2401, 99999, "2401以上"),
]


def distance_bucket(distance_m: "int | None") -> "str | None":
    if not distance_m:
        return None
    for lo, hi, label in DISTANCE_BANDS:
        if lo <= distance_m <= hi:
            return label
    return None


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


def build_stat_rows(groups: dict, as_of_date: str) -> list:
    rows = []
    for (jockey_name, stat_category, stat_key), entries in groups.items():
        starts = len(entries)
        wins = sum(1 for e in entries if e["finish_position"] == 1)
        places = sum(1 for e in entries if e["finish_position"] <= 3)
        win_odds_sum = sum(e["odds_win"] for e in entries if e["finish_position"] == 1 and e["odds_win"] is not None)
        roi_win_pct = round(win_odds_sum / starts * 100, 2) if starts else None
        if roi_win_pct is not None:
            roi_win_pct = max(-9999.99, min(9999.99, roi_win_pct))
        rows.append(
            {
                "jockey_name": jockey_name,
                "stat_category": stat_category,
                "stat_key": stat_key,
                "starts": starts,
                "wins": wins,
                "win_rate": round(wins / starts * 100, 2) if starts else None,
                "place_rate": round(places / starts * 100, 2) if starts else None,
                "roi_win_pct": roi_win_pct,
                "data_source": DATA_SOURCE,
                "as_of_date": as_of_date,
            }
        )
    return rows


JOB_NAME = "compute_jockey_stats"


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
    parser = argparse.ArgumentParser(description="past_performancesからjockey_statsを計算する")
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
        pp_rows = client.select_paginated(
            "past_performances",
            {
                "select": "jockey_name,finish_position,odds_win,track_type,distance_m,keibajo_name",
                "finish_position": "not.is.null",
                "jockey_name": "not.is.null",
            },
        )
        print(f"[読み込み] past_performances(jockey_name設定済み)={len(pp_rows)}件", file=sys.stderr)

        groups: dict = defaultdict(list)
        for pp in pp_rows:
            fp = pp.get("finish_position")
            if fp is None or fp <= 0:
                continue
            entry = {"finish_position": fp, "odds_win": pp.get("odds_win")}
            for category, key in (
                ("track_type", pp.get("track_type")),
                ("course", pp.get("keibajo_name")),
                ("distance_band", distance_bucket(pp.get("distance_m"))),
            ):
                if not key:
                    continue
                groups[(pp["jockey_name"], category, key)].append(entry)

        print(f"[集計] groups={len(groups)}", file=sys.stderr)

        as_of_date = datetime.date.today().isoformat()
        rows = build_stat_rows(groups, as_of_date)

        if args.dry_run:
            print(f"[dry-run] jockey_stats {len(rows)}件を書き込む予定(スキップ)", file=sys.stderr)
            for r in rows[:5]:
                print(json.dumps(r, ensure_ascii=False))
            return

        client.upsert("jockey_stats", rows, on_conflict="jockey_name,stat_category,stat_key,data_source")
        print(f"[jockey_stats] {len(rows)}件 upsert完了", file=sys.stderr)
        finish_pipeline_run(run_id, "success")
    except Exception as e:
        finish_pipeline_run(run_id, "failed", str(e))
        raise


if __name__ == "__main__":
    main()
