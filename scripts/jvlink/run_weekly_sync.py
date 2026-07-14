"""fetch_raw.py → parse_records.py → load_to_supabase.py を1コマンドで順に実行する
オーケストレーター。Windowsタスクスケジューラから週1回呼び出す想定。

差分同期: fetch_raw.pyが実行成功時に書き出す out/last_sync.txt (JVOpenのlastfiletimestamp)を
次回のfromtimeとしてそのまま再利用する。ファイルが無ければ直近7日分から開始する。

前提:
- 同じディレクトリに fetch_raw.py / parse_records.py / load_to_supabase.py / setup.py があること
- JV-Link接続設定が済んでいること (初回のみ別途 `py -3.12-32 setup.py` を実行しておく。
  これはこのスクリプトには含めない — 対話的なダイアログが出るため自動実行に向かない)
- Supabase書き込み用の認証情報を、このディレクトリの `.env.jvlink` (git管理対象外) に
  以下の形式で置いておくこと:
    NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=xxxx
  ⚠️ このファイルは絶対にgit commitしないこと (.gitignoreで除外設定済み)。個人PC上でのみ
  保持する前提の運用(単一ユーザーの自動化スクリプト向けの一般的な妥協)。

32bit/64bit Pythonの使い分け: fetch_raw.pyはJV-Link COM(32bit専用)を使うため
`py -3.12-32`で実行する必要がある。バージョン番号はWindows側の実際のインストール状況に
合わせて下記PY32_TAGを調整すること。parse_records.py/load_to_supabase.pyはCOM不要のため
このスクリプトを実行しているPython(64bit想定)でそのまま実行できる。
"""

import datetime
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

# 環境に合わせて調整すること (Windows側で `py -3.12-32 fetch_raw.py ...` が動くことを確認済みの値)
PY32_TAG = "-3.12-32"

OUT_DIR = SCRIPT_DIR / "out"
LOG_DIR = SCRIPT_DIR / "logs"
ENV_FILE = SCRIPT_DIR / ".env.jvlink"

JOB_NAME = "jvlink_weekly_sync"


def run(cmd: list, log) -> None:
    print(f"$ {' '.join(str(c) for c in cmd)}", file=log, flush=True)
    subprocess.run(cmd, check=True, cwd=SCRIPT_DIR, stdout=log, stderr=log)


def load_env_file(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


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
    body = {
        "status": status,
        "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    if error_message:
        body["error_message"] = error_message[:2000]
    _pipeline_runs_request("PATCH", f"?id=eq.{run_id}", body)


def compute_fromtime() -> str:
    last_sync_file = OUT_DIR / "last_sync.txt"
    if last_sync_file.exists():
        value = last_sync_file.read_text(encoding="utf-8").strip()
        if value:
            return value
    # 初回や状態ファイルが無い場合は直近7日分まで遡る
    return (datetime.datetime.now() - datetime.timedelta(days=7)).strftime("%Y%m%d%H%M%S")


def main() -> None:
    if not ENV_FILE.exists():
        print(
            f"{ENV_FILE} が見つかりません。NEXT_PUBLIC_SUPABASE_URL / "
            "SUPABASE_SERVICE_ROLE_KEY を書いたファイルを用意してください。",
            file=sys.stderr,
        )
        sys.exit(1)

    load_env_file(ENV_FILE)
    run_id = start_pipeline_run()

    LOG_DIR.mkdir(exist_ok=True)
    OUT_DIR.mkdir(exist_ok=True)
    log_path = LOG_DIR / f"sync_{datetime.datetime.now():%Y%m%d_%H%M%S}.log"
    fromtime = compute_fromtime()

    with open(log_path, "w", encoding="utf-8") as log:
        print(f"[週次同期開始] fromtime={fromtime}", file=log, flush=True)
        try:
            run(
                ["py", PY32_TAG, "fetch_raw.py", "RACE", fromtime, "1", str(OUT_DIR), "--fix-mojibake"],
                log,
            )
            run([sys.executable, "parse_records.py", str(OUT_DIR), str(OUT_DIR)], log)
            run(
                [
                    sys.executable,
                    "load_to_supabase.py",
                    str(OUT_DIR / "RA_parsed.csv"),
                    str(OUT_DIR / "SE_parsed.csv"),
                    "--env-file",
                    str(ENV_FILE),
                    "--hr-csv",
                    str(OUT_DIR / "HR_parsed.csv"),
                ],
                log,
            )
        except subprocess.CalledProcessError as e:
            print(f"[週次同期失敗] {e}", file=log, flush=True)
            print(f"[週次同期失敗] 詳細は {log_path} を確認してください。", file=sys.stderr)
            finish_pipeline_run(run_id, "failed", str(e))
            sys.exit(1)
        print("[週次同期完了]", file=log, flush=True)

    finish_pipeline_run(run_id, "success")
    print(f"[週次同期完了] ログ: {log_path}")


if __name__ == "__main__":
    main()
