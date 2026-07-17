#!/bin/bash
# launchd(com.keibaapp.snsresults.plist)から土・日 17:30に呼ばれる想定のラッパー。
# 当日の全レース確定後に、配当同期→ROI集計→結果ポストまでを通しで実行する。
# (従来はWindowsの月曜7:00バッチだけがROI集計をしていたため、当日の結果報告ができなかった)
# launchdはPATHをほぼ空の状態で起動するため、Homebrewのnpm/node/pythonを明示的に通す。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# 対象レースはJRA(日本時間)。Mac本体のTZに関わらず日付計算はJSTで固定する
SYSTEM_OFFSET=$(date +%z)  # TZを固定する前にシステム側の設定を確認する
export TZ=Asia/Tokyo
cd "$(dirname "$0")/.."

if [ "${SYSTEM_OFFSET}" != "+0900" ]; then
  echo "[warn] システムのTZがJSTではありません(${SYSTEM_OFFSET})。launchdの発火時刻がJST基準からズレます"
fi

TODAY=$(date +%Y-%m-%d)

echo "=== $(date) 配当同期 (${TODAY}) ==="
npm run sync:netkeiba:payouts -- --date "${TODAY}" --allow-today --env-file .env.local

echo "=== $(date) ROI集計 (${TODAY}) ==="
python3 scripts/compute_recommendation_results.py --env-file .env.local

echo "=== $(date) 結果ポスト (${TODAY}) ==="
npm run sns:auto -- --mode results --date "${TODAY}" --env-file .env.local
