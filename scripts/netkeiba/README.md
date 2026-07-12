# netkeiba同期バッチ

AGENTS.mdの「netkeibaアンチスクレイピング対策の詳細と対応方針」に従い、Vercel側の予想生成パスからは
完全に切り離し、Windows PC側 (JV-Linkと同じ環境) から低頻度バッチとして実行する前提のスクリプト。

- 正直なUser-Agentを送り、リクエスト間隔を5秒以上空ける (`httpClient.ts`)
- playwright-stealth等の検知回避技術は使わない
- 1レースの取得・書き込みに失敗しても処理全体は止めず、次のレースへ進む (グレースフルデグラデーション)

## 対象データ

`race.netkeiba.com/race/result.html?race_id=...` のレース結果ページから、出走馬ごとの
`past_performances` (着順・タイム・上がり3F・コーナー通過順・ペース等) を取得する。
JV-Data優先原則に従い、JV-Dataで代替できる情報 (基本の出走情報・馬体重等) はこのスクリプトの対象にしない。

netkeiba側の馬ID (URLの `/horse/XXXXXXXXXX/`) は、中央競馬所属馬であれば`horses.jv_horse_id`
(JV-Data血統登録番号) と同一という前提でマッチングしている。**この前提は要検証**。
一致する馬がまだ`horses`テーブルにない場合はスキップし、ログに残して処理を続行する。

**✅ netkeiba race_idは`races.jv_race_key`と完全に同一の12桁フォーマット(実データで確認済み、2026-07-12)。**
函館1R(2026-07-05、芝1200m)で検証し、JV-Data側の`race_entries`(finish_position/odds_win/
actual_popularity/finish_time_sec)と全項目・全9頭で完全一致した。これにより「同期対象の
race_idリストをどう組み立てるか」は自前の`races`テーブルを`race_date`で絞って`jv_race_key`を
引くだけで済む(下記`sync:netkeiba:recent`参照)。

## 実行方法

手動で特定レースだけ同期する場合:
```
npm run sync:netkeiba -- <netkeiba race_id> [<race_id> ...]
```
`race_id`は`race.netkeiba.com/race/result.html?race_id=XXXXXXXXXXXX`のクエリパラメータ (12桁)。

直近N日分(デフォルト7日)の`races`テーブルの内容をまとめて同期する場合(スケジュール実行向け):
```
npm run sync:netkeiba:recent -- [--days N]
```
`scripts/netkeiba/syncRecentRaces.ts`が`races`から`race_date >= 今日-N日`かつ`track_type != '障害'`
(下記「既知の制約」参照)の`jv_race_key`一覧を取得し、`syncPastPerformances()`にまとめて渡す。

**✅ 2026-07-12、過去に確定済みだった106レース(障害3レースを除く全平地レース)を
このコマンドで一括バックフィル済み。** `past_performances`が事実上空だった状態から、
実際に開催済みの平地レースの過去走データが一通り揃った状態になった。

実行には以下の環境変数が必要 (`.env.local`と同じ値):
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Windows PCでのスケジュール化 (未実施)

このリポジトリの外側の作業。JV-Linkの定期実行と同じマシン上で、タスクスケジューラから
`npm run sync:netkeiba:recent`(引数なしで直近7日分)を叩く形を想定している。
`run_weekly_sync.py`(月曜6:00)・`ComputeRecommendationResults`(月曜7:00)と同じ並びで、
月曜8:00あたりに登録するのがよさそう(その週の開催が確定した後に実行したいため)。

## 既知の制約・未検証事項

- netkeiba側のマークアップ変更で`parseRaceResult.ts`のセレクタが壊れる可能性がある。定期的な動作確認が必要
- 着差 (`margin_sec`) は馬身表記からの概算変換であり、正確な秒数ではない
- グレード (`grade`) の抽出は`Icon_GradeType`クラスの存在に依存しており、重賞レースでの動作は未検証 (今回サンプルにした未勝利戦にはグレード表示がないため)
- 血統データはこのスクリプトの対象外 (AGENTS.mdの方針通りJBISサーチ/studbook.jpを別途検討する)
- **⚠️ 障害レースでは`agari_3f_sec`が物理的にあり得ない値(13〜14秒台)になる既知のバグがある**(2026-07-12発見)。
  障害レース特有のHTML構造に`parseRaceResult.ts`のセレクタが対応できていないと見られる。
  障害レースは診断対象外の方針のため実害はなく、`sync:netkeiba:recent`はデフォルトで障害レースを除外している
