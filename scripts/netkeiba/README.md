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

**✅ `--env-file <path>`にも対応済み(2026-07-12)。** Windowsタスクスケジューラ等、シェルでの
`source`が使えない環境から実行する場合、`npm run sync:netkeiba -- ... --env-file <path>`や
`npm run sync:netkeiba:recent -- --env-file <path>`のように指定すると、そのファイルから
`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`を読み込む
(`scripts/jvlink/load_to_supabase.py`の`--env-file`と同じ設計)。Mac側でクリーンな環境
(`env -i`)から実行して動作確認済み。

## Windows PCでのスケジュール化 (✅完了・実機動作確認済み、2026-07-12)

JV-Linkの定期実行と同じマシン上で、タスクスケジューラから`sync:netkeiba:recent`(引数なしで
直近7日分)を`run_weekly_sync.py`(月曜6:00)・`ComputeRecommendationResults`(月曜7:00)の
後、月曜8:00に実行するよう登録済み。

**前提: このWindows PCにはNode.jsが入っていなかったため、`winget install --id OpenJS.NodeJS.LTS`
(LTS、確認時点でv24.18.0)で導入した。** `npm install`でこのリポジトリの依存関係も導入済み。

`npm run sync:netkeiba:recent`はタスクスケジューラの`/tr`から直接叩きにくい(npm経由の
複雑な引用符ネストが崩れやすい)ため、`scripts/netkeiba/run_sync_recent_task.bat`
(個人PC固有の絶対パスを含むため`.gitignore`対象、機体ごとに作成する想定)を用意し、
これがcwdを固定した上で`node.exe`から`node_modules\tsx\dist\cli.mjs`を直接叩く形にしている:
```bat
@echo off
setlocal
set "LOGDIR=%~dp0logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOGFILE=%LOGDIR%\sync_recent_last.log"
call :main > "%LOGFILE%" 2>&1
exit /b %ERRORLEVEL%

:main
cd /d "%~dp0..\.."
"C:\Path\To\nodejs\node.exe" "node_modules\tsx\dist\cli.mjs" "scripts\netkeiba\syncRecentRaces.ts" --env-file "scripts\jvlink\.env.jvlink"
```
登録:
```
schtasks /create /tn "SyncNetkeibaRecent" /sc weekly /d MON /st 08:00 /f ^
  /tr "C:\Path\To\keiba-app\scripts\netkeiba\run_sync_recent_task.bat"
```

**⚠️ハマった点:** 最初`cd /d`の対象をバッチファイル内に日本語を含む絶対パスとして直接
書いていたところ、対話的なPowerShellから叩けば動くのにタスクスケジューラ経由(非対話実行)
だと`cd`自体が失敗し、バッチファイルが`exit code 9`や`1`で即座に落ちる現象が発生した
(非対話cmd.exeのコードページ起因と推測、原因の完全な特定はできていない)。
`%~dp0`(バッチファイル自身のパスをOSから動的に取得する変数)を使う形に書き換えたところ解消した。
このバグの調査中に気づいたが、**Task SchedulerからのバッチはデフォルトでNode.jsの標準出力を
どこにも残さない**ため、上記の通り`> ログファイル 2>&1`でのリダイレクトが実質必須。

**✅実機で`schtasks /run`によりトリガーし、動作確認済み:** 直近7日・70レース分・
929件のpast_performancesを実際にupsertし、`schtasks /query`の`Last Result=0`
(所要時間: 開始17:35:08〜終了17:40:57、約5分49秒)で完了することを確認した。

## 既知の制約・未検証事項

- netkeiba側のマークアップ変更で`parseRaceResult.ts`のセレクタが壊れる可能性がある。定期的な動作確認が必要
- 着差 (`margin_sec`) は馬身表記からの概算変換であり、正確な秒数ではない
- グレード (`grade`) の抽出は`Icon_GradeType`クラスの存在に依存しており、重賞レースでの動作は未検証 (今回サンプルにした未勝利戦にはグレード表示がないため)
- 血統データはこのスクリプトの対象外 (AGENTS.mdの方針通りJBISサーチ/studbook.jpを別途検討する)
- **⚠️ 障害レースでは`agari_3f_sec`が物理的にあり得ない値(13〜14秒台)になる既知のバグがある**(2026-07-12発見)。
  障害レース特有のHTML構造に`parseRaceResult.ts`のセレクタが対応できていないと見られる。
  障害レースは診断対象外の方針のため実害はなく、`sync:netkeiba:recent`はデフォルトで障害レースを除外している
