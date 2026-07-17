#!/bin/bash
# launchd(com.keibaapp.diagnoseupcoming.plist)から金・土 22:00に呼ばれる想定のラッパー。
# 「前日夜に馬券を買う」運用に合わせ、翌日開催分の出走表・オッズを最新化してから
# 標準診断(screening→standard)を全レースへまとめてかける。
# launchdはPATHをほぼ空の状態で起動するため、Homebrewのnpm/nodeを明示的に通す。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# 対象レースはJRA(日本時間)。Mac本体のタイムゾーンが何であれ日付計算はJSTで固定する
# (2026-07-17、Macが+07になっていて日付がズレかけた実績あり)。
# ⚠️launchdの発火時刻はシステムのTZで解釈されるため、これだけでは時刻ズレは直らない。
# Mac本体をJSTに設定しておくことが前提(docs/sns-automation.md参照)。
SYSTEM_OFFSET=$(date +%z)  # TZを固定する前にシステム側の設定を確認する
export TZ=Asia/Tokyo
cd "$(dirname "$0")/.."

if [ "${SYSTEM_OFFSET}" != "+0900" ]; then
  echo "[warn] システムのTZがJSTではありません(${SYSTEM_OFFSET})。launchdの発火時刻がJST基準からズレます"
fi

TOMORROW=$(date -v+1d +%Y-%m-%d)
TOMORROW_COMPACT=$(date -v+1d +%Y%m%d)

echo "=== $(date) 出走表・オッズ更新 (${TOMORROW}) ==="
npm run sync:netkeiba:shutuba -- --date "${TOMORROW_COMPACT}" --env-file .env.local

echo "=== $(date) 標準診断バッチ (${TOMORROW}) ==="
npm run diagnose:upcoming -- --date "${TOMORROW}" --env-file .env.local

# 診断の完了を待ってから「あすの診断」を投稿する。時刻ベースで別タスクにすると
# 診断が長引いたとき中途半端なデータで投稿してしまうため、あえてここに連結している
# (set -eにより診断が失敗した場合は投稿もされない)。
echo "=== $(date) SNS投稿 (前日夜・${TOMORROW}分) ==="
npm run sns:auto -- --mode evening --date "${TOMORROW}" --env-file .env.local
