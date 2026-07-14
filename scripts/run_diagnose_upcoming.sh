#!/bin/bash
# launchd(com.keibaapp.diagnoseupcoming.plist)から金・土 22:00に呼ばれる想定のラッパー。
# 「前日夜に馬券を買う」運用に合わせ、翌日開催分の出走表・オッズを最新化してから
# 標準診断(screening→standard)を全レースへまとめてかける。
# launchdはPATHをほぼ空の状態で起動するため、Homebrewのnpm/nodeを明示的に通す。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/.."

TOMORROW=$(date -v+1d +%Y-%m-%d)
TOMORROW_COMPACT=$(date -v+1d +%Y%m%d)

echo "=== $(date) 出走表・オッズ更新 (${TOMORROW}) ==="
npm run sync:netkeiba:shutuba -- --date "${TOMORROW_COMPACT}" --env-file .env.local

echo "=== $(date) 標準診断バッチ (${TOMORROW}) ==="
npm run diagnose:upcoming -- --date "${TOMORROW}" --env-file .env.local
