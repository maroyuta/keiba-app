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
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

# 環境に合わせて調整すること (Windows側で `py -3.12-32 fetch_raw.py ...` が動くことを確認済みの値)
PY32_TAG = "-3.12-32"

OUT_DIR = SCRIPT_DIR / "out"
LOG_DIR = SCRIPT_DIR / "logs"
ENV_FILE = SCRIPT_DIR / ".env.jvlink"


def run(cmd: list, log) -> None:
    print(f"$ {' '.join(str(c) for c in cmd)}", file=log, flush=True)
    subprocess.run(cmd, check=True, cwd=SCRIPT_DIR, stdout=log, stderr=log)


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
                ],
                log,
            )
        except subprocess.CalledProcessError as e:
            print(f"[週次同期失敗] {e}", file=log, flush=True)
            print(f"[週次同期失敗] 詳細は {log_path} を確認してください。", file=sys.stderr)
            sys.exit(1)
        print("[週次同期完了]", file=log, flush=True)

    print(f"[週次同期完了] ログ: {log_path}")


if __name__ == "__main__":
    main()
