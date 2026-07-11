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
   **⚠️既知の差異:** ワイドのみ、1番目の組み合わせの人気順は一致するが、2番目・3番目の
   組み合わせの人気順が2レースとも±1ずれた(函館1R: JV-Data側が5・3人気に対しnetkeiba表示は
   6・4人気/福島5R: JV-Data側が27・40人気に対しnetkeiba表示は28・41人気)。組み合わせ・払戻金額
   自体は2レースとも完全一致しており、ズレの方向も一定でない(レースによって+1/-1と逆)ため、
   バイトオフセットの実装ミスではなくJV-Data側とnetkeiba側でワイドの人気順集計方法自体が
   異なる可能性が高いと判断した。`race_payouts`でワイドの`ninki`列を使う場合はこの既知のズレを
   踏まえること

**✅ `load_to_supabase.py`はWindows側で見つかった2つのバグ修正を反映し、完全に一本化済み
(2026-07-11)。** (1) 各payload関数が行ごとにNoneキーを削除していたため送信JSONのキー集合が
行によってバラつき、PostgRESTが`"All object keys must match"`で拒否していた問題 → 常に
全キーを持たせ値が無い場合は`None`を明示的に入れる方式に統一。(2) JV-Dataが同じレース/馬の
情報を複数回(出走表版→確定版等)送ってくることがあり、1バッチ内に同じconflictキーの行が
複数あると`"ON CONFLICT DO UPDATE command cannot affect row a second time"`で失敗していた
問題 → `dedupe_by_key()`を追加し、races/race_entriesのupsert直前に重複キーを除去(最後の
1件を採用)するよう修正。どちらもMac側で単体テスト済み。

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

**まだ個別に裏取りできていないもの:**
- `grade`(grade_cdからのG1/G2/G3判定): A/B/Cのみ対応。検証に使った2026-07-05のサンプルに
  該当レースが無かった可能性があり、重賞レースでの確認はまだ
- track_type境界値の詳細(10番台=芝・20番台=ダートの境界、直線/右左等の細かい違い)は
  大枠が正しいことしか確認できていない

**この検証はMac側から直接Supabaseに問い合わせて実施した(Windows側の作業は不要だった)。**
再検証したい場合は `curl` で `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/races` 等を叩けばよい。

## 既知の制約・未検証事項 (fetch_raw.py/setup.py)

- レコードの文字コードは`cp932`想定。文字化けする場合は上記「文字化け対策」を反映すること
- Windowsタスクスケジューラでの定期実行設定は、コマンド例をREADMEに用意した段階(上記
  「run_weekly_sync.py」参照)。実際の`schtasks`登録・動作確認はまだ

## 参考にした実装例

- https://zenn.dev/nozele/articles/c64e456d0c77e4 (JVInit/JVSetUIProperties/JVOpen/JVRead呼び出しパターン)
- https://github.com/ShunMorr/JVLink-python (JVReadループの戻り値処理パターン)
