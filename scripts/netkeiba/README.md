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

## 実行方法

```
npm run sync:netkeiba -- <netkeiba race_id> [<race_id> ...]
```

`race_id`は`race.netkeiba.com/race/result.html?race_id=XXXXXXXXXXXX`のクエリパラメータ (12桁)。

実行には以下の環境変数が必要 (`.env.local`と同じ値):
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Windows PCでのスケジュール化 (未実施)

このリポジトリの外側の作業。JV-Linkの定期実行と同じマシン上で、タスクスケジューラから
`npm run sync:netkeiba -- <当日のrace_id一覧>` を叩く形を想定しているが、実際の設定はまだ行っていない。
race_idの一覧をどう組み立てるか (前日の開催レース一覧から自動生成する等) も未設計。

## 既知の制約・未検証事項

- netkeiba側のマークアップ変更で`parseRaceResult.ts`のセレクタが壊れる可能性がある。定期的な動作確認が必要
- 着差 (`margin_sec`) は馬身表記からの概算変換であり、正確な秒数ではない
- グレード (`grade`) の抽出は`Icon_GradeType`クラスの存在に依存しており、重賞レースでの動作は未検証 (今回サンプルにした未勝利戦にはグレード表示がないため)
- 血統データはこのスクリプトの対象外 (AGENTS.mdの方針通りJBISサーチ/studbook.jpを別途検討する)
