# JV-Link同期バッチ (Python, 一部Windows専用)

JV-LinkはWindows専用の32bit COMコンポーネントのため、データ取得(`fetch_raw.py`)と接続設定
(`setup.py`)は**Windows PC上で32bit Pythonから**実行する必要がある。一方、パース(`parse_records.py`)と
Supabase書き込み(`load_to_supabase.py`)はJV-Link COMに依存しない純粋なテキスト処理なので、
Mac/Windowsどちらでも(32bit/64bit問わず)実行できる。

## 現状 (2026-07-11時点) — Windows側との差分はreconcile済み

**Windows PC上でこのリポジトリを直接クローンし、`parse_records.py`の移植・`--fix-mojibake`の
有効化・`run_weekly_sync.py`のend-to-end実行まで完了した。** fetch_raw.py → parse_records.py →
load_to_supabase.pyの一連のパイプラインは、このリポジトリのコードそのままでWindows実機での
動作を確認済み(詳細は下記)。もう「別セッションの作業をこのリポジトリに反映する」という
差分は残っていない。

**Windows実機で検証済みの内容:**
- JV-Link接続・生データ取得・RA(レース詳細)/SE(馬毎レース情報)/JG(競走馬除外情報)のパース
- 過去の完了済みレース(2026-07-05開催分)で再取得し、着順・タイム・オッズ・人気が実際の結果と
  一致することを確認済み
- `run_weekly_sync.py`を1回通しで実行し、fetch(4203件、RA/SE/JG含め13種別) →
  parse(RA=145, SE=1904, JG=1504) → Supabase upsert(races=144, horses=1848,
  race_entries=1470, skipped=0)まで成功することを確認
- 続けてもう一度実行(=fromtimeが前回のlastfiletimestampと同じ差分同期のケース)すると、
  JVOpenが公式エラーコード一覧(-100番台以降)には無い`-1`を返して例外落ちすることを発見。
  「新規データなし」の正常系として扱うよう`fetch_raw.py`を修正し、再実行してEXIT=0で
  完了することを確認済み(下記「各修正の反映状況」参照)
- ローカルSQLiteに読み込みrace_idでJOINできることも確認済み(`load_to_db.py`、Windows側のみ。
  このリポジトリには未収録)

## 各修正の反映状況

1. **✅ 反映済み** `JVSetUIProperties()`を毎回呼ぶと実行のたびに「JV-Link設定」ダイアログが出て
   非対話実行がブロックされる問題 → 初回のみ実行する`setup.py`に分離した。`fetch_raw.py`からは
   `JVSetUIProperties()`の呼び出しを削除済み
2. **✅ 反映済み・Windows実機の本物の文字化けデータで検証済み(2026-07-11)** 文字化け対策 —
   `mojibake.py`に`fix_mojibake()`を実装し、`fetch_raw.py --fix-mojibake`で明示的に有効化
   できるようにした(デフォルトは無効。システムロケールが日本語で問題が発生しない環境で
   正常なデータを壊さないための opt-in 設計)。このWindows PCはシステムロケールが日本語
   以外に設定されており実際に文字化けが発生する環境であることを確認済みで、`run_weekly_sync.py`
   の`fetch_raw.py`呼び出しに`--fix-mojibake`を付けて実行し、「テイクケア」「和田正一」
   「阿津　昌弘」等の実データが正しく復元されることを確認した(合成データでのテストだけでなく
   実機の本物の文字化けデータでの検証が完了)
3. `READ_BUFFER_SIZE`はこのリポジトリでは`300000`を設定済みで、Windows側で発生した
   「バッファサイズ0でSTATUS_STACK_BUFFER_OVERRUN」問題は元から回避できている
4. **✅ 反映済み** `parse_records.py`(RA/SE/JGのフィールド単位パーサー)をWindows側の
   `JVData_Struct.cs`突き合わせ検証済みコードのまま追加(このリポジトリで書き起こしていないので
   バイトオフセットの検証済み品質を保っている)
5. **✅ 反映済み・Windows実機で検証済み(2026-07-11)** 差分同期(`run_weekly_sync.py`)で
   `fromtime`に前回の`lastfiletimestamp`と全く同じ値を渡すケース(=前回同期以降新規データが
   無い場合。差分同期では毎回起こり得る)で、JVOpenが公式エラーコード一覧(-100番台以降)には
   無い`errcode=-1`を返し例外で落ちる問題を発見。`option==1`かつ`errcode==-1`は「新規データ
   なし」を意味する正常系として扱うよう`fetch_raw.py`の`fetch()`を修正し、`run_weekly_sync.py`
   を続けて2回実行してどちらもEXIT=0で完了することを確認した
6. **✅ 反映済み・Windows実機で検証済み(2026-07-11)** レコードtxtの累積防止 — レコードは
   追記(mode="a")で書き込むため、掃除しないと差分同期のたびに`RA.txt`等へ蓄積し、後段の
   パース/upsert対象が全履歴に膨らみ続ける(毎週新規データがある実運用で顕在化する。upsert
   自体は冪等なのでデータ破損はしないが、生ファイルの肥大と再処理コストの増大を招く)。JVOpen
   成功時に前回までのレコードtxt(`last_sync.txt`は除く)を消してから書き込むよう修正
7. **✅ 反映済み・Windows実機で検証済み(2026-07-11)** レコードtxtの改行の乱れ — テキストモードの
   `\n`→`\r\n`変換により、JVレコードが末尾に持つ`\r\n`が`\r\r\n`に化け、さらに`data + "\n"`と
   合わさってレコードごとに空行と余分な`\r`が混入していた(生txtが約2倍サイズになり`\r`が乱れる。
   パースは`rstrip`で吸収するのでデータ自体は正しく取れていたが不健全)。`open(..., newline="")`で
   改行変換を無効化し、`data.rstrip("\r\n") + "\n"`で末尾の区切りを一度落としてから`\n`を1つだけ
   付けるよう修正。修正後、生txtがレコード数ちょうど(RA=145/SE=1904/JG=1504、空行0)になり、
   パース件数・日本語(「テイクケア」「和田正一」等)が不変であることを確認した
8. **✅ 反映済み・実データ照合済み(2026-07-11)** `parse_records.py`に`parse_hr()`(HR=払戻情報、
   `JVData_Struct.cs`の`JV_HR_PAY`構造体に完全準拠)を追加し、`PARSERS`に登録した。単勝・複勝・
   枠連・馬連・ワイド・馬単・3連複・3連単の組み合わせ(`{bet_type}_combination{n}`)・払戻金円
   (`{bet_type}_payout_yen{n}`)・人気順(`{bet_type}_ninki{n}`)を`_flatten_list()`でフラット化
   (Mac側`load_to_supabase.py`が`race_payouts`へ変換しやすいよう、列名は`bet_type`/`combination`/
   `payout_yen`/`ninki`をベースにしたスネークケースで統一)。実データ照合として、2026-07-04開催の
   函館1R(`race_id=202602010701`)・福島5R(`race_id=202603020305`)の2レース分をnetkeibaの
   結果・払戻ページと突き合わせ、**単勝・複勝・枠連・馬連・馬単・3連複・3連単は組み合わせ・
   払戻金額・人気順のすべてが完全一致**することを確認した。
   **⚠️既知の差異:** `combination`(組み合わせ)・`payout_yen`(払戻金額)は検証した3レース
   (函館1R・福島5R・小倉11R北九州記念、計36組み合わせ)すべてで完全一致した一方、`ninki`
   (人気順)のみ稀に±1ずれるケースが見つかった(函館1R: ワイドの2・3番目/福島5R: ワイドの
   2・3番目/北九州記念: ワイドの3番目と馬単)。ズレの方向は一定でなく(レースによって+1/-1)、
   ワイドに限らず他の賭式(馬単)でも起きているため、バイトオフセットの実装ミスではなく
   JV-Data側とnetkeiba側で人気順の集計タイミング・方法自体に細かな差異がある可能性が高いと
   判断した。**払戻金額そのものは信頼度が高いためROI集計には支障ないが、`race_payouts.popularity`
   列を「万馬券等の把握」以外の用途(厳密な人気順比較等)に使う場合はこの既知のズレを踏まえること**

**✅ `load_to_supabase.py`はWindows側で見つかった2つのバグ修正を反映し、完全に一本化済み
(2026-07-11)。** (1) 各payload関数が行ごとにNoneキーを削除していたため送信JSONのキー集合が
行によってバラつき、PostgRESTが`"All object keys must match"`で拒否していた問題 → 常に
全キーを持たせ値が無い場合は`None`を明示的に入れる方式に統一。(2) JV-Dataが同じレース/馬の
情報を複数回(出走表版→確定版等)送ってくることがあり、1バッチ内に同じconflictキーの行が
複数あると`"ON CONFLICT DO UPDATE command cannot affect row a second time"`で失敗していた
問題 → `dedupe_by_key()`を追加し、races/race_entriesのupsert直前に重複キーを除去(最後の
1件を採用)するよう修正。どちらもMac側で単体テスト済み。

**✅ `race_payouts`へのupsert機能を追加・実データで動作確認済み(2026-07-11)。**
`--hr-csv HR_parsed.csv`を指定すると、単勝・複勝・枠連・馬連・ワイド・馬単・3連複・3連単の
組み合わせ(例: ワイド`"2-7"`、3連単`"7-2-5"`)・払戻金円・人気順を`race_payouts`へ
`(race_id, bet_type, combination)`でupsertする。`race_id`の解決はこの実行内のraces
upsert結果を優先し、無ければ`jv_race_key`でSupabaseへ問い合わせて補完するため
`HR_parsed.csv`単体での実行にも対応している。`run_weekly_sync.py`も`--hr-csv`付きで
呼び出すよう更新済み。2026-07-05開催分の実データ(72レース・858件)で実際にupsertし、
`skipped=0`で完了・Supabase側の値が上記netkeiba照合結果と一致することを確認した。

## セットアップ (Windows PC側、fetch_raw.py/setup.py用)

1. JV-Link本体をインストール・利用キー登録済みであること (`AGENTS.md`のモデル階層節参照)
2. **32bit版のPython**をインストールする (64bit PythonからはJV-LinkのCOMサーバーを呼べず
   `REGDB_E_CLASSNOTREG`エラーになる)
3. `pip install -r requirements.txt` (pywin32のみ)
4. `py -3.12-32 setup.py` を一度だけ実行し、「JV-Link設定」ダイアログで接続設定を確認・保存する
   (バージョン番号は環境に合わせて読み替え。以降は`fetch_raw.py`実行時にこのダイアログは出ない)

## 実行方法

```
python fetch_raw.py <dataspec> <fromtime> <option> <out_dir> [--fix-mojibake]
python parse_records.py <out_dir> <parsed_out_dir>   # RA_parsed.csv / SE_parsed.csv / JG_parsed.csv を生成
python load_to_supabase.py <RA_parsed.csv> <SE_parsed.csv> --env-file ../../.env.local
```

- `dataspec`: 4桁データ種別IDを連結した文字列。例: `"RACE"`
- `fromtime`: option=1,3,4のときは`YYYYMMDDhhmmss`または`YYYYMMDDhhmmss-YYYYMMDDhhmmss`。option=2 (今週データ)のときは`"1"`固定
- `option`: 1=通常データ(差分)、2=今週データのみ(軽量)、3/4=セットアップ(初回一括)。詳細は`AGENTS.md`の「JVOpenのoption/dataspec制約」参照
- `load_to_supabase.py`は`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`が必要 (`--env-file`で`.env.local`を指定するか、事前にexport)。**手動での検証実行時はWindows側に認証情報を置かず、CSVをMac側に渡してMacで実行すること。** ただし週次の完全自動実行(`run_weekly_sync.py`、下記)は無人実行が前提のため、この場合に限りWindows PCのローカルファイル(`.env.jvlink`、gitignore対象・git commit厳禁)に認証情報を置く運用を許容している(個人PC上の自動化スクリプトとしての一般的な妥協。チャットへの貼り付けやgitへのコミットとは区別すること)

## run_weekly_sync.py (週次自動実行オーケストレーター、2026-07-11追加)

`fetch_raw.py → parse_records.py → load_to_supabase.py` を1コマンドで順に実行する。
Windowsタスクスケジューラから週1回呼び出す想定。

**差分同期の仕組み:** `fetch_raw.py`がoption=1で成功すると、JVOpenが返す`lastfiletimestamp`を
`out/last_sync.txt`に保存する(2026-07-11追加)。`run_weekly_sync.py`は次回実行時にこの値を
そのまま`fromtime`として再利用するので、毎回全件取得ではなく前回以降の差分だけを取得できる。
`last_sync.txt`が無い場合(初回)は直近7日分から開始する。

**セットアップ:**
1. `py -3.12-32 setup.py` を一度だけ手動実行し、JV-Link接続設定を済ませる(対話的なダイアログが
   出るため`run_weekly_sync.py`には含めていない)
2. `scripts/jvlink/.env.jvlink` を作成し、以下を書く(このファイルはgit管理対象外):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=xxxx
   ```
3. 動作確認: `python run_weekly_sync.py` を手動で一度実行し、`logs/`にログが残ること・
   Supabaseにデータが入ることを確認する
4. 確認できたらWindowsタスクスケジューラに登録する(例):
   ```
   schtasks /create /tn "JVLinkWeeklySync" /sc weekly /d MON /st 06:00 ^
     /tr "\"C:\Path\To\python.exe\" \"C:\Path\To\jvlink\run_weekly_sync.py\""
   ```
   (`python.exe`と`run_weekly_sync.py`の実際のパスに置き換えること。`fetch_raw.py`の呼び出しは
   スクリプト内部で`py -3.12-32`を使うため、タスク自体は64bit Pythonで登録してよい)

**✅ 検証済み(2026-07-11):** Windows PC上で`run_weekly_sync.py`を実際に1回通しで実行し、
fetch(4203件、RA/SE/JG含め13種別) → parse(RA=145, SE=1904, JG=1504) → Supabase upsert
(races=144, horses=1848, race_entries=1470, skipped=0)まで一括で成功することを確認した。

## fetch_odds.py (レース前オッズのリアルタイム取得、2026-07-12追加)

`fetch_raw.py`が使うJVOpen(蓄積系、レース確定後データ)とは別に、JV-Linkには
**JVRTOpen(速報系)というリアルタイムデータ専用のAPI**がある。データ種別`"0B31"`で
`JVRTOpen(dataspec, race_key)`を呼ぶと、発売開始後(金土日に随時更新)の単勝・複勝・枠連
オッズ(レコード種別`"O1"`、`JV_O1_ODDS_TANFUKUWAKU`構造体)がその場で取得できる。

**✅ Windows実機で実際に動作確認済み(2026-07-12):** 本日開催の「七夕賞」(福島2回6日目11R)に対し
`py -3.12-32 fetch_odds.py 2026071203020611 out` → `py -3.12-32 parse_records.py out out` →
`python load_to_supabase.py out/RA_parsed.csv out/SE_parsed.csv --env-file .env.jvlink
--o1-csv out/O1_parsed.csv`の一連の流れで、実際に16頭全頭の`race_entries.odds_win`
(4.7倍〜100.6倍)・`expected_popularity`(1〜16位)をSupabaseへ反映できることを確認した。

**⚠️race_keyのフォーマットに注意:** `JVRTOpen`のrace_keyは`races.jv_race_key`(12桁: 年4+
場コード2+回2+日目2+レース番号2)とは**異なり**、`RACE_ID`構造体と同じ**16桁**
(年4+月日4+場コード2+回2+日目2+レース番号2、例: 2026年7月12日福島2回6日目11R →
`"2026071203020611"`)。実機で動作確認済み。

**使い方:**
```
py -3.12-32 fetch_odds.py <16桁のrace_key> out
py -3.12-32 parse_records.py out out
python load_to_supabase.py out/RA_parsed.csv out/SE_parsed.csv --env-file .env.jvlink --o1-csv out/O1_parsed.csv
```

**現状の制約:**
- `run_weekly_sync.py`にはまだ組み込んでいない(週次バッチはレース確定後データが対象のため、
  レース単位・当日随時実行が前提のオッズ取得とはライフサイクルが異なる。当日朝〜発走前に
  対象レースのrace_keyを列挙して繰り返し呼ぶような別オーケストレーターが別途必要)
- 複勝(`fukusho_odds_low/high`)・枠連(`wakuren_kumi/odds`)は`parse_o1()`でパース済みだが、
  `load_to_supabase.py`側では単勝(`odds_win`/`expected_popularity`)しかSupabaseへ反映していない
  (race_entriesに複勝・枠連オッズを格納する列が無いため。必要になったら別テーブル設計を検討)
- 時系列でのオッズ変動追跡(発売開始直後→直前でどう動いたか)は未対応。`load_to_supabase.py`は
  現在値で`race_entries`を上書きするのみ

## load_to_supabase.py の既知の制約・要検証事項

**✅ 2026-07-05開催分の実データ(RA=144件・horses=1848件・race_entries=1470件、skipped=0)を
実際にSupabaseへ投入し、以下を確認済み(2026-07-11):**
- `odds_win`(オッズ、10倍値と仮定して/10): 同一レース内でactual_popularity(確定人気)と
  完全に単調増加の関係にあることを確認(人気1位=最安オッズ〜人気15位=最高オッズまで矛盾なし)。
  オッズと人気は本来表裏一体の関係のため、この一致はスケール変換が正しいことの強い裏付けになる
- `jockey_weight_kg`(斤量、10倍値と仮定して/10): 52.0〜55.0kgという実在する範囲で取得できた
- `track_type`(track_cdからの芝/ダート/障害判定、10番台=芝・20番台=ダート・50番台=障害という
  想定): 実際に小倉1Rが「障害」と判定され、かつ同レースのtrack_condition=重・weather=雨という
  内部的に矛盾のない組み合わせで取得できたことから、少なくとも50番台=障害の境界は正しいと確認
- `weather`/`track_condition`: 複数レースで天候と馬場状態の組み合わせが実際にあり得る形
  (雨→重、晴→良等)で一貫しており、コード変換に大きな誤りは無さそうと判断できる
- `finish_time_sec`(タイムのMSS.d形式→秒変換): 同一レース内で着順順にタイムが単調増加して
  いることを確認(107.3秒→122.4秒)。Windows側の実データ検証("1098"=1分09秒8)と合わせて確度が高い

**✅ 重賞レースでの直接照合により完全に裏取り済み(2026-07-11、上記の内部整合性チェックに続く追加検証):**
小倉11R「北九州記念」(G3、芝1200m、2026-07-05、`race_id=202610020411`)をnetkeibaの結果・
払戻ページと突き合わせ、以下が**すべて完全一致**することを確認した。
- `grade`: Supabase側`G3`、netkeiba表示「北九州記念(G3)」で一致 → grade_cdの`A`/`B`/`C`→
  G1/G2/G3変換が実データで裏取りできた(これまで未検証だった項目)
- `track_type`/`track_condition`/`weather`/`distance_m`: 芝1200m・馬場「重」・天候「小雨」が
  netkeiba表示と完全一致
- `odds_win`/`jockey_weight_kg`/`finish_time_sec`/`actual_popularity`/`finish_position`:
  出走13頭全頭についてnetkeibaの着順表(オッズ・斤量・タイム・人気・着順)と1件ずつ突き合わせ、
  全項目が完全一致(例: 1着フリッカージャブ=斤量57.5kg・オッズ3.0倍・人気1・タイム68.0秒)

これにより、当初「要検証」としていたgrade/track_type境界値/odds_win/jockey_weight_kgのスケールは
すべて実データで確認が取れた状態になった。

**⚠️軽微な既知の粗:** `horse_weight_diff_kg`(馬体重増減)は、実際の増減が0kgのケースで
`zogen_fugo`(増減記号)が空白になるため現状の実装では`None`(計測不能扱い)を返す。本来は
「初出走等で計測不能」と「実際に増減0kg」を区別すべきだが、現状は両方とも`None`になっており
区別できていない。回収率計算等には影響しないため優先度は低いが、`load_to_supabase.py`の
`build_entry_payload()`側で直す余地がある

**この検証はMac側から直接Supabaseに問い合わせて実施した(Windows側の作業は不要だった)。**
再検証したい場合は `curl` で `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/races` 等を叩けばよい。

## 既知の制約・未検証事項 (fetch_raw.py/setup.py)

- レコードの文字コードは`cp932`想定。文字化けする場合は上記「文字化け対策」を反映すること
- Windowsタスクスケジューラでの定期実行設定は、コマンド例をREADMEに用意した段階(上記
  「run_weekly_sync.py」参照)。実際の`schtasks`登録・動作確認はまだ

## 参考にした実装例

- https://zenn.dev/nozele/articles/c64e456d0c77e4 (JVInit/JVSetUIProperties/JVOpen/JVRead呼び出しパターン)
- https://github.com/ShunMorr/JVLink-python (JVReadループの戻り値処理パターン)
