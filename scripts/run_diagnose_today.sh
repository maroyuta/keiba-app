#!/bin/bash
# launchd(com.keibaapp.diagnosetoday.plist)から土日10:00に呼ばれる想定のラッパー。
# 前夜22:00バッチ(run_diagnose_upcoming.sh)の補完枠。TZ不整合や枠順確定の遅れで
# 前夜分が漏れていた場合のセーフティネットとして、当日開催分を再度診断し直す。
# 既に診断済みのレースはdiagnoseUpcoming.tsが再実行してもコストの二重発生はしない
# (screeningでC評価済みなら早期打ち切り、standard済みでも再診断自体は許容設計)。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SYSTEM_OFFSET=$(date +%z)
export TZ=Asia/Tokyo
cd "$(dirname "$0")/.."

if [ "${SYSTEM_OFFSET}" != "+0900" ]; then
  echo "[warn] システムのTZがJSTではありません(${SYSTEM_OFFSET})。launchdの発火時刻がJST基準からズレます"
fi

TODAY=$(date +%Y-%m-%d)
TODAY_COMPACT=$(date +%Y%m%d)

echo "=== $(date) 出走表・オッズ再同期 (${TODAY}) ==="
npm run sync:netkeiba:shutuba -- --date "${TODAY_COMPACT}" --env-file .env.local

echo "=== $(date) 標準診断バッチ (${TODAY}) ==="
npm run diagnose:upcoming -- --date "${TODAY}" --env-file .env.local
