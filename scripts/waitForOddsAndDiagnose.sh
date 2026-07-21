#!/bin/bash
# 2026-07-19朝、「オッズが0件のまま」で全頭診断がブロックされた事態への対応として新設。
# JRA公式サイトは既に発売済みでオッズが出ていることを確認済みだが、
# netkeiba側は単勝オッズが「プレミアムサービス限定」表示になっており、
# JV-Link(Windows)側のリアルタイムオッズ取得(run_odds_watch.py)もタスクスケジューラ未登録の
# 疑いがある(過去セッションで未検証のまま残っていた)。原因不明のままいつ解消するか読めないため、
# DB上のodds_win充足率とnetkeiba再同期を定期的に試み、オッズが入り次第、自動で全頭診断バッチへ進む。
set -uo pipefail
export TZ=Asia/Tokyo
cd "$(dirname "$0")/.."

DATE="${1:-$(date -v+1d +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)}"
DATE_COMPACT=$(echo "$DATE" | tr -d '-')
BASE_URL="${2:-http://localhost:3000}"
INTERVAL_SEC=900   # 15分おき。netkeibaへの負荷配慮(レート制限対応)とオッズ反映待ちのバランス
MAX_ITER=48        # 15分×48 = 12時間で打ち切り(それでも入らなければ人間の判断待ち)

echo "[start] $(date) ${DATE}分のオッズ待機開始(最大${MAX_ITER}回、${INTERVAL_SEC}秒間隔)"

for i in $(seq 1 "$MAX_ITER"); do
  # DB側を軽量チェック(Windows JV-Linkが直接書き込んでいる場合もこれで拾える)。
  # tsx -eはCJS出力のためトップレベルawait不可・env-fileも自動ロードされないので、
  # async IIFEで包み、node標準の--env-fileフラグで明示的に読み込む。
  ODDS_COUNT=$(npx tsx --env-file=.env.local -e "
    (async () => {
      const { createNetkeibaSyncClient } = await import('./scripts/netkeiba/supabaseClient');
      const supabase = createNetkeibaSyncClient();
      const { data: races } = await supabase.from('races').select('id').eq('race_date', '${DATE}');
      const ids = (races ?? []).map((r) => r.id);
      if (ids.length === 0) { console.log(0); return; }
      const { count } = await supabase.from('race_entries').select('id', { count: 'exact', head: true }).in('race_id', ids).gt('odds_win', 0);
      console.log(count ?? 0);
    })();
  " 2>/dev/null | tail -1)

  echo "[poll ${i}/${MAX_ITER}] $(date) DB上のoddsあり件数=${ODDS_COUNT:-0}"

  if [ "${ODDS_COUNT:-0}" -gt 0 ]; then
    echo "[found] $(date) オッズが確認できました。診断バッチを開始します。"
    break
  fi

  # DBに無ければnetkeiba側の再同期も試す(無料、oddsUpdatedが0件超なら反映される設計)
  npm run sync:netkeiba:shutuba -- --date "${DATE_COMPACT}" --env-file .env.local > /tmp/shutuba_poll_${DATE_COMPACT}.log 2>&1 || true
  NK_ODDS=$(grep -o "オッズ更新=[0-9]*件" "/tmp/shutuba_poll_${DATE_COMPACT}.log" | grep -o "[0-9]*" || echo 0)
  echo "[poll ${i}/${MAX_ITER}] $(date) netkeiba再同期オッズ更新=${NK_ODDS:-0}件"
  if [ "${NK_ODDS:-0}" -gt 0 ]; then
    echo "[found] $(date) netkeiba経由でオッズが入りました。診断バッチを開始します。"
    break
  fi

  if [ "$i" -eq "$MAX_ITER" ]; then
    echo "[giveup] $(date) ${MAX_ITER}回試しても${DATE}分のオッズが取得できませんでした。人間の確認が必要です。"
    exit 1
  fi
  sleep "$INTERVAL_SEC"
done

echo "[diagnose] $(date) 全頭診断バッチ開始 (${DATE}, base-url=${BASE_URL})"
npm run diagnose:upcoming -- --date "${DATE}" --base-url "${BASE_URL}" --env-file .env.local
echo "[done] $(date) 診断バッチ完了"
