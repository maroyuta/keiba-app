#!/bin/bash
# launchd(com.keibaapp.snspost.plist)から呼ばれる想定のラッパー。
#   金・土 22:30 → --mode evening (翌日分の「あすの診断」)
#   土・日 07:30 → --mode morning (当日分の「きょうの狙い」)
# モードは引数で受け取る。launchdはPATHをほぼ空の状態で起動するため明示的に通す。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# 対象レースはJRA(日本時間)。Mac本体のTZに関わらず日付計算はJSTで固定する
SYSTEM_OFFSET=$(date +%z)  # TZを固定する前にシステム側の設定を確認する
export TZ=Asia/Tokyo
cd "$(dirname "$0")/.."

if [ "${SYSTEM_OFFSET}" != "+0900" ]; then
  echo "[warn] システムのTZがJSTではありません(${SYSTEM_OFFSET})。launchdの発火時刻がJST基準からズレます"
fi

MODE="${1:?使い方: run_sns_post.sh evening|morning}"

echo "=== $(date) SNS自動投稿 (${MODE}) ==="
npm run sns:auto -- --mode "${MODE}" --env-file .env.local
