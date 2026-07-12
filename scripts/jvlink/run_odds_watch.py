"""当日の発売中レースを対象に、発走前まで一定間隔で
fetch_odds.py → parse_records.py → load_to_supabase.py を繰り返し呼ぶオーケストレーター。

run_weekly_sync.py(レース確定後データを週1回)とはライフサイクルが異なるため独立させた。
Windowsタスクスケジューラから開催日の朝〜夕方まで15〜30分間隔程度で繰り返し実行する想定
(1回の実行で、まだ発走していない当日の全レースを順番に処理し、発走済みのレースはスキップする)。

前提:
- 同じディレクトリに fetch_odds.py / parse_records.py / load_to_supabase.py があること
- JV-Link接続設定(setup.py)が済んでいること
- run_weekly_sync.pyと共通の .env.jvlink (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
  が用意されていること

race_keyの組み立て: races.jv_race_key(12桁: 年4+場コード2+回2+日目2+レース番号2)と
races.race_date(YYYY-MM-DD)から、JVRTOpenが要求する16桁のrace_key
(年4+月日4+場コード2+回2+日目2+レース番号2)を組み立てる(fetch_odds.py README参照)。

⚠️load_to_supabase.pyのra_csv/se_csvについて: 本来は同一のRA/SEデータを指すべき必須引数だが、
オッズ単体更新ではその日の新しいRA/SEデータを持たない。README記載の旧手順は前回
run_weekly_sync.pyのout/を使い回す想定だったが、古い(前回同期時点の)race_entriesで
上書きしてしまうリスクがあるため、このスクリプトでは意図的に空ファイルを渡す
(0行なのでraces/horses/race_entriesへのupsertは発生せず、--o1-csv経由のオッズ更新のみ行われる)。

⚠️Windows実機での検証はまだ行っていない(2026-07-13時点、Mac側での設計のみ)。
次回Windows PC側のセッションで実際にJV-Link経由の疎通・タスクスケジューラ登録まで確認すること。
"""

import datetime
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ENV_FILE = SCRIPT_DIR / ".env.jvlink"
OUT_ROOT = SCRIPT_DIR / "out_odds"
LOG_DIR = SCRIPT_DIR / "logs"

# 環境に合わせて調整すること (fetch_raw.py/run_weekly_sync.pyと同じ32bit Pythonタグ)
PY32_TAG = "-3.12-32"


def load_env_file(path: Path) -> dict:
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def to_race_key(jv_race_key: str, race_date: str) -> str:
    """jv_race_key(12桁)+race_date(YYYY-MM-DD) → JVRTOpen用の16桁race_key"""
    year = jv_race_key[0:4]
    rest = jv_race_key[4:12]  # 場コード2+回2+日目2+レース番号2
    month_day = race_date.replace("-", "")[4:8]  # race_dateのMMDD部分
    return f"{year}{month_day}{rest}"


def fetch_today_races(supabase_url: str, service_key: str, race_date: str) -> list:
    query = urllib.parse.urlencode(
        {
            "race_date": f"eq.{race_date}",
            "select": "id,jv_race_key,race_date,post_time,race_number,keibajo_name",
            "order": "post_time.asc",
        }
    )
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/races?{query}",
        headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_odds_for_race(race_key: str, log) -> bool:
    """1レース分のオッズ取得〜Supabase反映を行う。成功したらTrue"""
    work_dir = OUT_ROOT / race_key
    work_dir.mkdir(parents=True, exist_ok=True)

    ra_csv = work_dir / "RA_parsed.csv"
    se_csv = work_dir / "SE_parsed.csv"
    ra_csv.touch()
    se_csv.touch()

    try:
        subprocess.run(
            ["py", PY32_TAG, str(SCRIPT_DIR / "fetch_odds.py"), race_key, str(work_dir)],
            check=True,
            cwd=SCRIPT_DIR,
            stdout=log,
            stderr=log,
        )
        subprocess.run(
            [sys.executable, str(SCRIPT_DIR / "parse_records.py"), str(work_dir), str(work_dir)],
            check=True,
            cwd=SCRIPT_DIR,
            stdout=log,
            stderr=log,
        )
        subprocess.run(
            [
                sys.executable,
                str(SCRIPT_DIR / "load_to_supabase.py"),
                str(ra_csv),
                str(se_csv),
                "--env-file",
                str(ENV_FILE),
                "--o1-csv",
                str(work_dir / "O1_parsed.csv"),
            ],
            check=True,
            cwd=SCRIPT_DIR,
            stdout=log,
            stderr=log,
        )
        return True
    except subprocess.CalledProcessError as e:
        print(f"[失敗] race_key={race_key}: {e}", file=log, flush=True)
        return False


def main() -> None:
    env = {**os.environ, **load_env_file(ENV_FILE)}
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print(
            f"{ENV_FILE} または環境変数に NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY "
            "がありません。",
            file=sys.stderr,
        )
        sys.exit(1)

    now = datetime.datetime.now()
    today = now.date().isoformat()

    LOG_DIR.mkdir(exist_ok=True)
    OUT_ROOT.mkdir(exist_ok=True)
    log_path = LOG_DIR / f"odds_watch_{now:%Y%m%d_%H%M%S}.log"

    try:
        races = fetch_today_races(supabase_url, service_key, today)
    except urllib.error.HTTPError as e:
        print(f"races取得失敗 ({e.code}): {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        sys.exit(1)

    with open(log_path, "w", encoding="utf-8") as log:
        print(f"[開始] {now} race_date={today} 対象レース候補={len(races)}件", file=log, flush=True)
        processed = 0
        for race in races:
            post_time = race.get("post_time")
            if not post_time:
                print(f"[スキップ] jv_race_key={race['jv_race_key']} post_timeなし", file=log, flush=True)
                continue

            post_dt = datetime.datetime.combine(
                datetime.date.fromisoformat(today), datetime.time.fromisoformat(post_time[:8])
            )
            if now >= post_dt:
                # 発走済みのレースは対象外(締切後のオッズ取得は意味がない)
                continue

            race_key = to_race_key(race["jv_race_key"], race["race_date"])
            label = f"{race.get('keibajo_name') or '?'}{race.get('race_number')}R"
            print(f"[対象] {label} race_key={race_key}", file=log, flush=True)
            ok = fetch_odds_for_race(race_key, log)
            print(f"[{'成功' if ok else '失敗'}] {label} race_key={race_key}", file=log, flush=True)
            processed += 1

        print(f"[完了] 処理対象{processed}件", file=log, flush=True)

    print(f"[完了] ログ: {log_path}")


if __name__ == "__main__":
    main()
