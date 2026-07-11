<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 競馬予想Webアプリ

## 📊 進捗率(目安、2026-07-12時点)

**JV-Link→Supabase自動同期パイプライン: 体感95%**
- JV-Link接続・生データ取得: 完了 ✅
- RA/SE/JGのフィールドパーサー: 完了 ✅ (Windows側で実データ検証済み)
- **Supabase書き込み: 完了 ✅ (2026-07-11、実データend-to-end検証済み)。** 2026-07-05開催分の
  実データ(races=144件・horses=1848件・race_entries=1470件、skipped=0)をSupabaseへ投入し、
  オッズ/斤量/タイム/track_type等の主要フィールドが実態と矛盾しないことを確認済み。
  **さらに小倉11R「北九州記念」(G3)をnetkeibaと直接突き合わせ、grade/track_type/
  track_condition/weather/odds_win/jockey_weight_kg/finish_time_secが全項目・全13頭で
  完全一致することを確認し、これまで「要検証」だったコード変換をすべて解消した**(詳細は
  `scripts/jvlink/README.md`「load_to_supabase.pyの既知の制約・要検証事項」参照)
- **✅ Mac/Windowsのコード一本化完了(GitHub経由)。** `scripts/jvlink/`に全ピースが揃った
- **✅ 差分同期・`run_weekly_sync.py`の通しテスト完了(2026-07-11)。** Windows実機で2回実行し、
  新規データありのケース・「差分なし」のケース両方でEXIT=0を確認。文字化け対策も実機の
  本物のデータで検証済み(詳細は`scripts/jvlink/README.md`参照)
- **✅ 枠順未確定時のupsertキー衝突バグを修正・DBのゴミ行36件を削除済み(2026-07-12)。**
- **残るはWindowsタスクスケジューラへの`schtasks`登録のみ。** コマンド例は用意済み、実際の登録・
  「本当に1週間放置して自動で回るか」の実地確認だけが未着手

**過去走データ(netkeiba経由の`past_performances`): 体感30%**
- スクレイパー自体は実データ2レース分で検証済み ✅ (平地レースはJV-Data側と完全一致、
  netkeiba race_idが`jv_race_key`と同一フォーマットであることも確認済み)
- ただしDBに実際に入っているのはこのテストの2レース分のみ。全レース分の投入・
  Windowsでの自動スケジュール化(schtasks)はこれから

**レース前オッズの取得: 完了 ✅ (2026-07-12、Windows実機で実データ検証済み)。**
`scripts/jvlink/fetch_odds.py`を新設し、JV-Linkの速報系API`JVRTOpen("0B31", race_key)`で
発売開始後の単勝オッズをリアルタイム取得できることを実機で確認した。本日開催の「七夕賞」
(福島2回6日目11R)で実際に16頭全頭の`race_entries.odds_win`(4.7倍〜100.6倍)・
`expected_popularity`(1〜16位)をSupabaseへ反映済み(詳細は`scripts/jvlink/README.md`
「fetch_odds.py」節参照)。**⚠️`run_weekly_sync.py`にはまだ未組み込み**(レース単位・
当日随時実行が前提のため、週次バッチとはライフサイクルが異なり別オーケストレーターが必要)。

**アプリ本体(診断ロジック・UI・ダッシュボード)のコード: 体感90%、ほぼ完成。** ただし
**「今日実際に開催されるレースの診断が出せるか」で言うと体感20〜30%程度。** 2026-07-12の
七夕賞で実地テストしたところ、過去走データとレース前オッズが両方とも空だったため、
Sonnetまで強制的に実行しても全16頭C評価・買い目なしという結果になった(詳細は下記
「⏸️ 引き継ぎ中の相談」参照)。上記2つのデータ源が揃わない限り、コードが正しくても
実用的な診断は出せない。

この数値は正確な計測ではなく体感の目安。**質問「今何%?」が来たら、この節を更新してから
答えること。** 次回の作業もここから状況を把握できる。

## ⏸️ 引き継ぎ中の相談 (2026-07-10更新、ここから再開)

**このセッションで実装済み(すべてgitコミット済み、ローカルのみ・push未実施):**

- 新馬戦・障害レースを診断対象外化(screeningすら呼ばない)
- screeningのC評価打ち切りは元々の実装のまま維持(コスト削減の追加効果はない、既存の見積もりに織り込み済み)
- premium(Opus)の自動エスカレーションを廃止し、`race_rank === "S"`のレースのみ手動の「本気診断」ボタン(`POST .../diagnose?tier=premium`)で実行する方式に変更
- オッズ妙味(エッジ)の評価ルールをプロンプトに追加(勝率の高さでなくオッズに対するエッジで本命/相手を選ぶ、人気同士の組み合わせも実際のワイド/馬連オッズ次第で妙味ありと判断してよい)
- 血統(`horse_pedigrees`、BLOD 3代血統)・調教(`training_sessions`再設計、HC/WC準拠)・種牡馬統計(`sire_stats`/`nick_stats`に`roi_win_pct`追加)を診断プロンプトに配線
- 回収率トラッキング用に`race_payouts`・`race_recommendation_results`テーブルを新設
- `/dashboard`(回収率ダッシュボード)を実装。サマリーカード→週/月/年グラフ→ランク別/競馬場別/買い方別の内訳テーブル(netkeiba「My収支」と同じ列構成)→個別レース一覧(的中/外れ絞り込み)の4段階構成

**次回セッションでまず確認すべきこと(優先度順):**

1. **✅ マイグレーション適用状況の確認・完了(2026-07-11)。** `20260710070000`(血統・調教・統計の再設計)は適用済み。**`20260710080000`(race_payouts/race_recommendation_results)は未適用だったことが判明し、その場でSQL Editorから適用した。`20260710090000`(race_recommendation_results.race_rank列)も同時に適用済み。** Mac側からSupabase REST APIを直接叩いて(`curl .../rest/v1/race_payouts?select=*&limit=1`のHTTPステータスで存在確認)、両テーブル・race_rank列とも存在することを確認済み
2. **`npm run build`(型チェック込み)がこのセッション中は一度も実行できていない。** node/npm/Supabase CLIがこのサンドボックスに一切無かったため。node環境のあるターミナルで実行し、特に以下を要チェック: `race_recommendation_results`の`races(...)`ネスト埋め込みselectの型付け(`src/app/dashboard/page.tsx`)、Tailwindの`line-clamp-1`(`RecommendationList.tsx`)
3. **実ブラウザでの動作確認も未実施。** `/dashboard`・「本気診断する」ボタン(S評価のレースにのみ表示されるか)・新馬/障害レースでdiagnoseが`{tier: "skipped"}`を返すか、をスマホ幅で確認する
3.5. **✅ `npm run dev`を実際に起動し`/api/races/[raceId]/diagnose`をPOSTで叩いて実地検証(2026-07-11)。重要な発見が2つ。**
   - **① 未来のレースは軒並み`race_entries`が壊れている。** 7/12開催の全レース(七夕賞を除く)が`(race_id, horse_number)`のupsertキー衝突で1頭分しか残っていないことが判明。原因は`load_to_supabase.py`の設計そのもの — 馬番(枠順)確定前の「登録」段階のSEレコードは全馬`horse_number="00"`で届くため、同じキーで何度も上書きされ最後の1頭しか残らない。7/11(当日)のレースは全部正常だったので、直近の同期タイミングでは日曜(7/12)の枠順抽選がまだ確定していなかったのが根本原因と推測。**七夕賞(福島11R、G3、17頭)は枠順確定が別扱いだったのか正常だった。**
   - **② 過去走データ(`past_performances`)が事実上空(全体で7件のみ)、かつ未来レースの`odds_win`は全馬0.0で未同期。** これにより七夕賞をstandard診断しようとしても、screening(Haiku)が「データ不足により判定不可」でC評価を返し、Sonnetまで進めなかった(=コスト制御としては正しい挙動、ただし実用上は診断が出せていない)。`past_performances`は`scripts/netkeiba/syncPastPerformances.ts`(`npm run sync:netkeiba`)で埋める設計だが、Windows側でのスケジュール化が未実施(README「Windows PCでのスケジュール化(未実施)」節に既知の課題として記載済み)。**さらに、レース前オッズ(`odds_win`)を埋める仕組みが現状どこにも存在しない**(JV-LinkのRA/SEは基本的に確定後データが中心で、直前の予想オッズはJV-Data側の別データ種別(速報系)かnetkeiba側の別ページ経由が必要と思われるが未調査・未実装。AGENTS.mdにこれまで記載がなかった新しいギャップ)。
   - **副産物として七夕賞の`race_entries`にも軽微なデータ品質バグを発見。** ヤマニンブークリエが`horse_number=0`(枠順未確定時の残骸)と`horse_number=15`(確定後の正しい行)で重複して残っている。上記①と同根の問題。screeningのAIはこれも「データ整合性に問題あり」として正しく検知していた。
   - **結論: 「全頭診断」機能自体(APIルート・プロンプト・screening→standardのコスト制御)は実装として正しく動作することを実地確認できたが、今のままでは実際にどのレースを叩いても実用的な診断は出せない。** 次にやるべきことは優先度順で (a) `load_to_supabase.py`のupsertキー設計を見直す(馬番未確定"00"の行を無視する、または`race_id + ketto_num`など安定したキーに変える)、(b) `npm run sync:netkeiba`をWindows側でスケジュール化して過去走データを埋める、(c) レース前オッズをどう取得するか調査する(JV-Dataの速報系データ種別 or netkeiba)。
   - **✅ (a)対応完了(2026-07-11)。** `load_to_supabase.py`の`race_entries`書き込みループで、`umaban`(馬番)が未確定(="00"→`to_int`で0)の行を同期対象から除外するよう修正。ダミーデータで「3頭とも未確定→0件登録・3件スキップ」「馬番確定後→3件とも登録」をユニットテストで確認済み(テストコード自体はリポジトリには未追加、スクラッチのみ)。**あわせて、この事故で既にDBに残っていたゴミ行(`horse_number=0`・`post_position=0`・`odds_win=0.0`、7/12開催36レース分・織姫賞含む)をSupabase REST APIから直接36件削除し、0件になったことを確認済み。** これで次回Windowsが同期しても同じ事故は起きないはず(実機での再検証はまだ)。
   - **✅ (b) `npm run sync:netkeiba`をMac側で実際に2レース分手動実行し、実データで検証完了(2026-07-12)。** 重要な発見: **netkeiba側のrace_id(`race.netkeiba.com/race/result.html?race_id=...`)は`races.jv_race_key`と完全に同一の12桁フォーマット**であることを実データで確認した(README「要検証」だった前提が解消)。これにより「同期対象のrace_idリストをどう組み立てるか」という設計課題は解消 — 自前の`races`テーブルから`race_date`で絞って`jv_race_key`を引くだけでよい。
     - 検証①: 小倉1R(2026-07-05、`jv_race_key=202610020401`)→ 実は障害レースだったため、`finish_time_sec`(約192〜206秒、2860mの障害としては妥当)は正常だが、**`agari_3f_sec`が13〜14秒という物理的にあり得ない値になっており、障害レースではこのフィールドのパースが壊れていることが判明**(600mを13秒台=時速150km超はあり得ない)。障害レースは既存方針で診断対象外のため実害はないが、`parseRaceResult.ts`のセレクタが障害レースのHTML構造differenceに対応できていない可能性が高い。
     - 検証②: 函館1R(2026-07-05、`jv_race_key=202602010801`、芝1200m、9頭)→ **JV-Data側の`race_entries`と全項目(finish_position・odds_win・actual_popularity・finish_time_sec)が完全一致。** upserted=9・skipped=0。平地レースについてはnetkeibaスクレイパーの品質は非常に高いと確認できた。
     - **まだ未着手: Windows側でのスケジュール化そのもの(schtasks登録)。** 上記の検証によりrace_idリストの組み立て方針は決まったので、実装のハードルは下がった。次にやるべきは、前日の開催race_id一覧を`races`テーブルから引いて`npm run sync:netkeiba`に渡すラッパースクリプトを書き、Windowsのタスクスケジューラに登録すること。
   - **✅ (c) レース前オッズの取得を実装・Windows実機で実データ検証完了(2026-07-12)。** Web調査で見つけた`JVRTOpen`(速報系API、データ種別`"0B31"`)をWindows実機で実際に叩いたところ、`JVRTOpen("0B31", race_key)`が成功(errcode=0)し、`JVData_Struct.cs`の`JV_O1_ODDS_TANFUKUWAKU`構造体とバイト単位で完全一致する962バイトのO1レコードが取得できることを確認した。**race_keyのフォーマットは`jv_race_key`(12桁)ではなく`RACE_ID`構造体と同じ16桁(年4+月日4+場コード2+回2+日目2+レース番号2)であることも実機で確定**(事前のWeb調査での「16桁っぽい」という推測が的中)。`scripts/jvlink/parse_records.py`に`parse_o1()`を追加し(単勝・複勝・枠連オッズすべてパース)、新設した`scripts/jvlink/fetch_odds.py`と`load_to_supabase.py`の`--o1-csv`オプションを通じて、本日開催の「七夕賞」で実際に16頭全頭の`odds_win`(4.7倍〜100.6倍)・`expected_popularity`(1〜16位)をSupabaseへ反映することまで確認済み(詳細は`scripts/jvlink/README.md`「fetch_odds.py」節参照)。**⚠️まだ`run_weekly_sync.py`への組み込みは未実施**(レース単位・当日随時実行が前提のため週次バッチとはライフサイクルが異なり、別途「当日朝〜発走前に対象レースを列挙して繰り返し呼ぶ」オーケストレーターの設計が必要)。複勝・枠連オッズは`parse_o1()`ではパース済みだが`race_entries`に格納先の列が無いため未反映(必要になれば別テーブル検討)。
4. **premium(Opus)診断の実測usageを取るか?** — まだユーザーの明示的な回答待ち(1回課金される)
5. **JV-Link接続 — ✅ 疎通確認完了 (2026-07-11)。** Windows PC側でClaude Codeを使い、実際にJV-Linkから生データの取得に成功した(RA=レース詳細37件、SE=馬毎レース情報492件、JG=1002件、合計1531件を取得・確認済み)。作業はこのリポジトリではなくWindows PC上の`C:\Users\maroy\OneDrive\デスクトップ\jvlink\`で別途行われており、このリポジトリの`scripts/jvlink/fetch_raw.py`(Mac側セッションで作成した雛形)とは別の実装になっている。Windows側での実装・デバッグ過程で判明した重要な知見:
   - `JVRead("", 0, "")`のようにバッファサイズに0を渡すと`STATUS_STACK_BUFFER_OVERRUN`でクラッシュする。十分な数値(例: 110000)を渡す必要がある(このリポジトリの`fetch_raw.py`は元から`READ_BUFFER_SIZE = 300000`を渡しており問題なし)
   - `JVSetUIProperties()`は実行のたびに「JV-Link設定」ネイティブダイアログが出て非対話実行がブロックされるため、毎回のダウンロードスクリプトからは外し、初回のみ実行する別スクリプト(`setup.py`)に分離するべき(このリポジトリの`fetch_raw.py`は現状`JVSetUIProperties()`を毎回呼ぶ設計のままなので、要修正)
   - 相対パス(`.\out`)は実行時のカレントディレクトリ次第で意図しない場所に保存されることがあるため、絶対パス指定が安全
   - 文字コードcp932は正しく機能している(ターミナル表示上の文字化けはコンソールのエンコーディング表示の問題で、ファイル自体は正しい)
   - **未確認:** `JG`レコードが何を指すか(RACE/SLOP/WOOD/BLODの調査時にはJG自体を確認していない)。次回JV-Data仕様書で要確認
   - **次のステップとしてWindows側でRA/SEのフィールド単位パーサー実装に着手依頼済み。** 進捗はWindows側のセッションで追うため、このリポジトリのコード変更(Supabase書き込み処理等)は別途反映が必要になる見込み
   - **✅ GitHubリモート設定・Mac/Windows双方の同期が完了(2026-07-11)。** `git@github.com:maroyuta/keiba-app.git`(private)を新設し、Mac/Windows両方にSSH鍵を登録(GitHub上のキー名は「mac」「windows」)。Mac→push、Windows→pull→`parse_records.py`追加→pushの流れで、**`scripts/jvlink/`が完全に一本化された**(fetch_raw.py/setup.py/mojibake.py/load_to_supabase.py/run_weekly_sync.pyはMac発、parse_records.pyはWindows発)。今後はスクショの手動コピペではなく`git pull`/`git push`でMac↔Windows間のコード共有ができる
   - **✅ 続けてRA/SEのフィールドパーサー(`parse_records.py`)も同日中にWindows側で完成・検証済み。** JRA-VAN公式配布の`JVData_Struct.cs`のバイトオフセット定義と完全一致することを確認し、馬名・騎手名・レース名等の日本語を含めて正しく抽出できることを検証済み(例: 馬名「ボーンディスウェイ」、騎手「丸山元気」、レース名「七夕賞」)
   - **重要な発見: 文字化けバグ。** Windowsのシステムロケール(非Unicodeプログラム用言語)が日本語でない環境だと、JV-LinkのBSTRがCP1252として誤変換され文字化けする。`parse_records.py`内に`fix_mojibake()`(CP1252の未定義5バイトを恒等変換で補完した逆マッピング)を実装して回避したが、恒久対策としてはWindows側で「コントロールパネル→地域→管理→システムロケールの変更→日本語」への変更(要再起動)が望ましい
   - **`parse_records.py`は64bit Pythonで実行可能**(COM不要のテキスト処理のため)。`fetch_raw.py`/`setup.py`(JV-Link接続、32bit必須)とは実行環境の制約が異なる点に注意。将来的にはパース以降の処理(Supabase書き込み等)はMac側でも開発できる見込み
   - Windows側の最終ファイル構成(`C:\Users\maroy\OneDrive\デスクトップ\jvlink\`): `fetch_raw.py`(ダウンロード)・`parse_records.py`(パース→CSV化)・`setup.py`(JV-Link接続設定、初回のみ)・`requirements.txt`
   - **✅ 過去の完了済みレース(2026-07-05開催)で再取得・検証したところ、着順(01,02,03...)・タイム(1098=1分09秒8)・オッズ・人気まで実データとして正しく取れることを確認済み。** `load_to_db.py`(Windows側)でRA/SE/JGのCSVをローカルSQLiteに読み込みrace_idでJOINできることも確認済み。JV-Link接続からパースまでのパイプライン全体が実データで動作検証された
   - **✅ Supabase書き込みスクリプト`scripts/jvlink/load_to_supabase.py`をMac側で新規作成(2026-07-11)。** RA_parsed.csv/SE_parsed.csvを読み込み、races/horses/race_entriesへPostgREST API経由でupsertする(標準ライブラリのみ使用、Mac/Windows両対応)。ダミーデータでのロジック単体テストは実施済みだが、**Windows側の実CSVを使ったend-to-endテストはまだ**。JV-Dataの数値コード変換(track_type/grade/weather/track_condition/odds_win/jockey_weight_kgのスケール)の一部は確度が低く要検証(詳細は`scripts/jvlink/README.md`参照)。finish_time_secの変換のみWindows側で実データ検証済みのため確度が高い
   - **✅ 差分同期の仕組み・週次自動実行オーケストレーターをMac側で追加(2026-07-11、Windowsが利用上限/シャットダウンで使えない間の作業)。** `fetch_raw.py`がoption=1成功時にJVOpenの`lastfiletimestamp`を`out/last_sync.txt`に保存するよう変更。新設した`scripts/jvlink/run_weekly_sync.py`が`fetch_raw.py`(32bit)→`parse_records.py`→`load_to_supabase.py`(64bit)を順に実行し、`last_sync.txt`があれば次回のfromtimeとして再利用する(無ければ直近7日分から開始)。Windowsタスクスケジューラへの`schtasks`登録コマンド例も`scripts/jvlink/README.md`に用意した。**⚠️この一連の自動化コードは一度もWindowsで実行できておらず未検証**(下記reconcile後に確認が必要)
   - **設計判断: 週次の完全自動実行に限り、Supabase認証情報をWindows PCのローカルファイル(`.env.jvlink`、gitignore対象)に置く運用を許容することにした。** 手動での検証実行(Mac側で`load_to_supabase.py`を直接叩く)では引き続きWindowsに認証情報を置かない方針を維持するが、無人実行の自動化には認証情報がその場に必要なため、個人PC上のgitignore済みローカルファイルとして保持する妥協をした(チャットへの貼り付け・gitコミットとは明確に区別)
   - **✅ `setup.py`分離・`fix_mojibake()`もMac側リポジトリに反映済み(2026-07-11、Windows利用上限中の作業)。** `scripts/jvlink/setup.py`(JVSetUIProperties専用、初回のみ)を新設し`fetch_raw.py`からは削除。`scripts/jvlink/mojibake.py`に`fix_mojibake()`を実装し、`fetch_raw.py --fix-mojibake`で明示的に有効化する設計(常時適用ではなくopt-in。システムロケールが日本語で問題が起きない環境を壊さないため)。**合成データ(正常文字列をわざとCP1252誤デコードして人工的に文字化けを再現)での往復変換テストは成功したが、Windows実機の本物の文字化けデータでの検証はまだ**
   - **✅ `run_weekly_sync.py`のWindows実機通しテスト完了(2026-07-11)。** fetch→parse→Supabase書き込みまで自動で繋がることを確認済み(上記「進捗率」節参照)
   - **✅完了(2026-07-11): `run_weekly_sync.py`をWindowsタスクスケジューラに登録した。**
     `schtasks /create /tn "JVLinkWeeklySync" /sc weekly /d MON /st 06:00 /f /tr "'C:\Users\maroy\AppData\Local\Python\pythoncore-3.14-64\python.exe' 'C:\Users\maroy\OneDrive\デスクトップ\keiba-app\scripts\jvlink\run_weekly_sync.py'"`
     で登録し、`schtasks /query /tn "JVLinkWeeklySync" /fo LIST /v`で以下を確認済み:
     Task To Run=`"C:\Users\maroy\AppData\Local\Python\pythoncore-3.14-64\python.exe" "C:\Users\maroy\OneDrive\デスクトップ\keiba-app\scripts\jvlink\run_weekly_sync.py"`、
     Schedule Type=Weekly、Days=MON、Start Time=6:00:00、Next Run Time=2026/07/13 6:00:00、Status=Ready。
     python.exeは64bit(`pythoncore-3.14-64`)で登録(`fetch_raw.py`内部の`py -3.12-32`呼び出しには影響しない想定)。
     **⚠️次に必要な確認:** 次回月曜(2026-07-13 6:00)の実行後に`Last Result`が0になっているか、
     `scripts/jvlink/logs/`にログが残っているかをチェックすること(登録時点ではまだ一度も自動実行されていない)。
   - **✅完了(2026-07-11): HRレコード(配当情報)のパーサーを追加した。** `JVData_Struct.cs`の`JV_HR_PAY`構造体でバイトオフセットを確認し、`parse_records.py`に`parse_hr()`を実装・`PARSERS`へ登録(詳細・netkeibaとの実データ照合結果は`scripts/jvlink/README.md`の「各修正の反映状況」8番、および上記`race_payouts`節を参照)。バックテストに必要だった配当データのパース手段はこれで揃った
   - **✅完了(2026-07-11): `load_to_supabase.py`の要検証項目をnetkeibaと直接突き合わせて解消した。** 小倉11R「北九州記念」(G3、2026-07-05)をnetkeibaの結果ページと照合し、grade/track_type/track_condition/weather/odds_win/jockey_weight_kg/finish_time_secが出走13頭全頭・レース情報ともに完全一致することを確認(詳細は`scripts/jvlink/README.md`参照)。**⚠️軽微な既知の粗として残るのは** `horse_weight_diff_kg`が実際の増減0kgと計測不能を区別できていない点のみ(回収率計算には影響しない)
   - **✅完了(2026-07-11): `race_payouts`へのupsert機能を`load_to_supabase.py`に追加し、実データで動作確認した。** `--hr-csv`引数を追加し、HR_parsed.csvの8賭式(単勝/複勝/枠連/馬連/ワイド/馬単/3連複/3連単)を`(race_id, bet_type, combination)`単位でupsertする。`race_id`解決はこの実行内のraces upsert結果を優先し、無ければ`jv_race_key`でSupabaseへ問い合わせて補完(HR単体実行にも対応)。`run_weekly_sync.py`も`--hr-csv`付きで呼ぶよう更新。2026-07-05開催分(72レース・858件)で実際にupsertし`skipped=0`で完了、Supabase上の値を小倉11R北九州記念のnetkeiba結果と再照合して`combination`/`payout_yen`が完全一致することも確認した。**⚠️`popularity`(人気順)のみ、ワイド・馬単で稀に±1ずれるケースがあった**(方向は一定でなくJV-Data側とnetkeiba側の集計差と推定。払戻金額自体は影響を受けないためROI集計には支障なし。詳細は`scripts/jvlink/README.md`参照)
   - **✅完了(2026-07-11): 旧作業フォルダを整理した。** `C:\Users\maroy\OneDrive\デスクトップ\jvlink\`(gitクローンではない方、リモート無しのローカルgit・3コミットのみ)の内容を`fetch_raw.py`/`parse_records.py`/`load_to_supabase.py`/`setup.py`ともkeiba-appリポジトリ側と`diff`で突き合わせ、リポジトリ側がすべて後続の修正(文字化け対策の分離・HRパーサー・race_payouts対応等)を含むスーパーセットであり、旧フォルダ側に未取り込みの独自コードが無いことを確認した。削除ではなく`jvlink_archived_20260711`へリネームしてアーカイブ(`.env.jvlink`やローカルSQLite `jvdata.db`/`jvdata_past.db`を含むため、完全削除はせず当面残す運用)
   - **✅完了(2026-07-11): `race_recommendation_results`算出バッチを実装した。** `scripts/compute_recommendation_results.py`を新設(Node.js非依存、`scripts/jvlink/load_to_supabase.py`と同じ標準ライブラリのみのREST方式)。honmei_horse_number設定済みかつrace_payoutsが存在する(=確定済み)レースを対象に、honmei/aiteの組み合わせを昇順(例:'2-12')に整形してrace_payoutsの`combination`と突き合わせ、bet_type('wide'/'umaren'/'both')に応じたstake_yen/return_yen/roi_pct/is_hitを算出し`race_recommendation_results`へupsertする。**検証: ローカル単体テスト6パターン(的中・不的中・単一賭式・honmei/aite順序反転・aite未設定・stake未設定)全て期待通りの結果を確認**。DBクエリ部分(races/race_payoutsの検索フィルタ)も実データに対するdry-runで疎通確認済み。**⚠️「本当に的中したケース」の本番投入テストは未実施** — 実運用中のレース行に偽の推奨データを書き込む形になり安全機構でブロックされたため意図的に見送った。実際の診断が確定済みレースに対してhonmei/aiteを出した時点で自然にend-to-end検証できる
   - **次回最優先: (1)** 実際に1週間分放置してみて`run_weekly_sync.py`の自動実行が無人で回るか確認する。**(2)** `compute_recommendation_results.py`をWindowsタスクスケジューラ等に登録し定期実行する運用を決める(現状は手動実行のみ)。**(3)** 実際の診断結果が確定済みレースに出た後、本当に的中したケースでrace_recommendation_resultsの値がnetkeiba等の実結果と一致するかend-to-endで検証する
   - **📋 次回セッションの計画: 過去100レース程度のバックテスト(ユーザー希望、2026-07-11)。** 単に診断ロジックを過去レースに適用するだけでなく、**「実際にワイド・馬連で買っていたら回収率はどうだったか」まで出したい**とのこと。配当データのパース・投入(HRレコード→race_payouts)、および的中・回収率算出バッチ(`compute_recommendation_results.py`)は完了したので、残る前提は(a)過去100レース分の診断をhonmei/aite/bet_amount付きで`races`へ実際に生成・投入すること、(b)生成後に`compute_recommendation_results.py`を実行すること、のみ。診断自体のAPI課金は100レース規模なら概算¥1,000程度に収まる見込み(実測単価は「API使用量の実測ログ機構」節参照)
   - **🔍 (Mac側、上記と並行して2026-07-11に実施) 簡易版の先行分析。** 当時はHRパーサー・`race_recommendation_results`が未実装だったため、正式なワイド/馬連ベースの回収率は算出できず、代わりにSupabase REST APIから直接races/race_entries全件(145レース・1484頭)を取得しPythonで集計する簡易分析を実施した(スクリプトはスクラッチパッドのみ、リポジトリには未追加)。**確定着順が付いていたのは145レース中70レース・912頭のみ**(残りは未来のレース or 結果未同期)。単勝オッズの逆数を「市場想定勝率」とみなし、実際の勝率との差(エッジ)・単勝回収率(近似、実際の買い方=ワイド/馬連とは異なる点に注意)をオッズ帯・馬体重増減・枠番・馬場状態・競馬場・距離帯などで集計。**結果、n=129と最大サンプルだったオッズ12〜20倍帯で実勝率8.5%が想定6.5%を上回り(エッジ+2.0pt、単勝回収率124%)、外枠(7-8枠)×芝×1700m以下(n=79)も想定9.0%に対し実勝率11.4%(エッジ+2.4pt、回収率104.6%)と、既存の「外差し有利」の経験則と整合する方向感が見られた。** 一方で馬体重+6〜9kg増(n=90)の単勝回収率298.7%、ダート5枠(n=48)の580.4%など一部の突出した数値は、大穴馬1〜2頭の的中に牽引されているだけで再現性のあるパターンとは言えない(n=70レースでは統計的に有意水準に達する区分はほぼ皆無)。**上記の通りHRパーサー・回収率算出バッチは既に完成しているため、この簡易分析はもう不要 — 次は実際の診断を過去レースに流し込むフェーズ。**

背景: ユーザーは当初月¥12,000のコストは払いたくない、実際に買うのは~5レース/日程度、という制約から相談を開始。その後¥4,000程度への圧縮・オッズ妙味重視の予想ロジック・回収率の可視化と話が進んだ。

## 全体構成

- Windows PC上のJV-LinkがJRAデータを定期取得し、Supabaseへ自動同期する(このリポジトリの外側の処理)
- 本アプリはスマホから使う予想インターフェース (Next.js, Vercelホスティング)
- 予想生成はClaude APIを直接呼び出す (`src/lib/claude/`)。チャット使用量上限の制約を受けない

## モデル階層 (コスト最適化)

`src/lib/claude/client.ts` の `CLAUDE_MODELS` で定義。呼び出しは `src/lib/claude/predict.ts`。

- `screening` = Haiku 4.5 (`claude-haiku-4-5`): 全レースの一次スクリーニング
- `standard` = Sonnet 5 (`claude-sonnet-5`): 標準レースの診断表生成
- `premium` = Opus 4.8 (`claude-opus-4-8`): 「本気で買う」と判定した重要レースのみ。**未勝利・新馬戦はrace_rank=Sが出てもpremiumへエスカレーションしない(2026-07-11)** — standard(Sonnet)止まり。新馬戦はもともとscreening自体を呼ばず対象外だが、未勝利はscreening→standardまで進むためS評価が付きうる。`route.ts`のpremiumゲート(`?tier=premium`)とUI側の「本気診断」ボタン表示(`DiagnoseButton.tsx`)の両方でrace_classの「未勝利」「新馬」を弾く。Why: 未勝利・新馬戦は情報量が少なく血統・調教等の判断材料が薄いため、高コストなOpus診断の投資対効果が低いとの判断

月額運用コスト目安: JRA-VAN会費込みで約4,000〜5,000円/月。

## 予想ロジック (3本柱+おまけ)

1. 絶対能力 (馬自体の実力)
2. ペース・位置取りの不利 (直近3走以上を追跡)
3. トラックバイアス (内前有利/外差し等)
4.5. (補助的加点材料) 装備変更 (ブリンカー等)・騎手による過剰人気への懐疑。あくまでおまけ的な参考要素
6. コース×距離ごとの枠順データ評価 (例: 阪神芝1200mは外枠有利など、コース特性ごとの枠順傾向をAPI取得データから分析し評価に反映)

## オッズ妙味 (エッジ) の評価 (2026-07-10確定)

的中率(能力の高さ)だけでなく、オッズに対する妙味(エッジ)を必ず評価に組み込む。

**妙味(エッジ) ≒ その馬の実際の勝率(推定) − オッズが示す市場想定勝率(単勝オッズの逆数)**

- 例: 単勝10倍(市場想定勝率10%)の馬が実力的に12%見込めるなら+2%の妙味あり
- 例: 単勝5倍(市場想定勝率20%)の馬が実力的にちょうど20%程度しか見込めないなら妙味は0(勝率・的中率自体はこちらが高くても、妙味では劣る)
- **勝率・的中率の高さではなく、この妙味(エッジ)が最大の馬を優先してhonmei/aiteを選ぶ。** 1・2番人気が実力的に明確に抜けている(僅差の混戦でない)場合、それらはオッズが低く妙味に乏しいため安易にhonmei/aiteにしない。上位人気馬同士の組み合わせ(1番人気×2番人気のワイド等)は原則非推奨
- 理想の買い目は「掲示板に載る可能性が高い手堅い1頭」+「妙味のある1頭」の組み合わせ
- **Why:** 1・2番人気を買い続けても収支はプラスになりにくく、逆に人気薄同士は的中率が低すぎて安定しない。何レースも買い続けたときの収支(回収率)は、勝率そのものではなくオッズ込みの期待値(妙味)で決まるため

## 馬券方針

- ワイド・馬連のみ。3連複は買わない
- 買い目は「本命→相手1頭」の1点に絞る
- 回収率重視

## レース投資判断

- 診断表作成前に、レース自体をS/A/B/Cで評価
  - S: 妙味のある買い目が組める、かつ的中率も高い
  - A: 妙味または的中率のどちらかが高い
  - B: 標準的、投資判断は任意
  - C: 見送り推奨
- 個別馬のランクとは別軸
- **1・2番人気が実力的に明確に抜けていて他馬との差が大きい(混戦でない)レースは、妙味のある買い目を組みにくいため、的中率が高そうでもrace_rankはA以下に留める。Sは「妙味のある組み合わせが実際に組める」レースに限定する**

## 診断表フォーマット

- 列: 枠・馬番・馬名・想定人気・S〜Cランク・短評 (1行)
- ランク別カラーコード: S=金、A=緑、B=青、C=グレー
- レース単位で想定トラックバイアス (`predicted_bias`) を明示 (例: 「内前有利、差しは届きにくい」)。races.bias_noteに書き戻す
- 下部に全体分析 (5項目):
  1. レース全体のレベル・層の厚さ
  2. 本命が堅い/危ない理由
  3. 相手の根拠
  4. 妙味馬 (過小評価馬) が出る理由
  5. ペース・展開想定 — 想定ペース(S/M/H)に加え、前残りになりそうか差しが届きそうかを明言する (結論の先送りをしない)
- オッズ取得できる場合はオッズ逆算による購入金額配分も表示

## リサーチルール (API直接取得のためフル調査)

- 人気に関わらず全頭、直近3走を1頭ずつ精査
- 各馬について: バイアス込みの不利、レース固有の不利 (出遅れ・包まれ・砂被り等)、±10kg以上の馬体重変動、ペースからの有利不利を確認
- 対戦相手のその後の成績でレースレベルも裏取り

## 枠順・消し判定のルール (簡略版)

- 本命候補が明確に不利な枠なら相手筆頭に格下げ、程度のシンプルな判断でよい
- 「過剰人気→評価を下げる」と「消し」は別物。コース適性がある馬 (前走同コースで0.3〜1.1差以内) は人気過剰でも3着候補として残す
- 断定的な「消し」は適性・能力が明らかに不足している馬のみ

## トラックバイアスの予測方法

トラックバイアスはその時々の馬場状態次第で変わるため、当日の勘ではなく直近の実データを根拠に予測する。
- 土曜のレース: 直近の同場開催 (基本的に先週の同場。開催初週で先週データがなければ前年以前の同時期開催まで遡って参照)
- 日曜のレース: 前日 (土曜) の同場レース
- 参照データがまだ存在しない場合 (運用開始直後等) は、コース形態や馬場状態からの一般論で予測しつつ、その旨を明示する
- 内前有利/外差しを強く意識する

## データソース

### オッズデータの鮮度・組み合わせオッズ (2026-07-10、要調査・未実装)

**現状の課題:** `race_entries.odds_win`(単勝オッズ)しかDBに保持しておらず、ワイド/馬連の組み合わせオッズは一切保持していない。「オッズ妙味」の判断(上記参照)は本来、個別の単勝オッズだけでなく実際のワイド/馬連オッズ(組み合わせの払い戻し)に対して行うべきだが、今はそのデータが無いため単勝オッズからの概算に留まっている。

**ユーザー指摘 (2026-07-10):** 1・2番人気が実力的に抜けすぎていて2頭ともほぼ確実に掲示板に載るような場合でも、そのワイドの実配当が4倍程度あれば妙味がある。人気同士かどうかではなく、組み合わせの実際のオッズで判断すべき。

**さらに、オッズはレース直前まで大きく変動する(特に締切直前の資金流入)。** 診断(特に`bet_amount_wide`/`bet_amount_umaren`の金額計算)は診断実行時点のオッズのスナップショットに依存するため、レースからかなり前に実行した診断は締切直前には的外れになりうる。

**次回調査・設計すること:**
1. JV-Dataにワイド/馬連等の組み合わせオッズのレコード種別(仕様書上ではO1〜O6等の名称、要確認)がどの頻度で更新されるか調査し、`race_entries`または新テーブルに組み合わせオッズを保持する設計を検討する
2. オッズの取得時刻(`odds_captured_at`等)をDBに持たせ、診断結果に「このオッズは何分前時点のものか」を明示できるようにする
3. 「本気診断」ボタン(premium、実際に買い目・金額を決める用途)は、締切直前の最新オッズで実行することを前提にした運用フロー・UI上の注意書きを検討する
- shutuba_past_9.htmlは2件目以降でペイウォールの可能性あり
- en.netkeiba.com/db/horse/[10桁ID]/ をmarkdown抽出・3600〜4200トークン制限で取得 (代替手段)
- JSレンダリングされたページは空データになるため使用不可
- レース5日以上前はshutuba_pastページが未公開の場合あり

### netkeibaアンチスクレイピング対策の詳細と対応方針 (2026-07-10調査)

netkeibaは2024年11月頃からスクレイピング対策を強化しており、現在も継続中。既存のリサーチルールに直接影響するため必ず踏まえること。

**制限の仕組み:**

- `User-Agent`ヘッダーがないリクエストはHTTP 400で即拒否される
- 短時間に多数アクセスするとIPアドレス単位で制限が発動 (明確な閾値は非公開)。制限は24時間で自動解除されるが、**解除申請は受け付けない**(netkeiba公式サポート記載)
- 単純ブロックだけでなく、スクレイピングと判定した場合に応答を意図的に遅延させたり、**血統データなどJSレンダリングされるコンテンツを省略/大幅遅延させる**ケースが報告されている。既存ルールの「JSレンダリングされたページは空データになるため使用不可」は、この対策が原因である可能性が高い
- netkeiba利用規約でサービス運営に支障をきたす行為(スクレイピング含む)を明示的に禁止しており、技術的制約だけでなく規約上のリスクでもある

**このアプリのアーキテクチャ固有のリスク:** Vercelのサーバーレス関数から都度netkeibaへライブアクセスする設計は、Vercelの共有IPレンジが他ユーザーのトラフィックに巻き込まれてブロックされる/このアプリの利用がVercel全体のIPレンジをブラックリスト化させるリスクがある。JV-LinkがWindows PCの固定的な家庭用IPから低頻度でバッチ同期しているのとは対照的。

**対応方針:**

1. **netkeibaスクレイピングはWindows PC側の定期同期バッチに寄せる** — JV-Linkと同じ環境で、リクエスト間隔を十分空けた低頻度バッチとして実行し、結果をSupabaseの`past_performances`(`data_source: 'netkeiba'`)等に保存する。Vercel側の予想生成リクエストパスからはライブスクレイピングを完全に排除し、DBから読むだけにする (現状のDB設計は既にこの分離を想定した形になっている)
2. **血統データはnetkeiba経由を避け、JBISサーチ/studbook.jpを優先する** (JS省略対象と確認されたため、[[reference-pedigree-data-sources]]も参照)
3. **正直なUser-Agentを送り、意図的なレート制限(リクエスト間隔を空ける)を実装する。playwright-stealth等の「検知回避」技術は使わない** (規約違反リスクをさらに高めるため)
4. **JV-Data優先原則** — JV-Dataで代替できる情報(レース結果・出走情報・馬体重等)はnetkeibaを使わず、netkeibaはJV-Dataでカバーできない補助的情報に限定する
5. **失敗時のグレースフルデグラデーション** — netkeiba取得失敗時は診断表生成自体を止めず、「一部データ取得失敗」として続行できる設計にする

### 追い切り(調教)タイムのデータソース (2026-07-10確定)

**JV-Data (JV-Link) に標準で含まれることを確認済み。追加費用・別契約不要。競馬ブック等の代替手段は不要と判断。**

JRA-VAN公式のJV-Data仕様書 Ver.4.9.0.1 (2024/8/7更新、`https://jra-van.jp/dlb/sdv/sdk/JV-Data4901.xlsx`) の「データ種別一覧」シートで確認:

- **坂路調教情報** (データ種別ID: `SLOP`、レコード種別ID: `HC`) — 美浦・栗東トレーニングセンターの坂路調教情報、2003年以降のデータを保有。フォーマットはトレセン区分(美浦/栗東)・調教年月日時刻・血統登録番号・800M地点からの4/3/2/1ハロンの合計タイムとラップタイム(いずれも200M刻み)
- **ウッドチップ調教情報** (データ種別ID: `WOOD`、レコード種別ID: `WC`) — 同じく美浦・栗東、2021年7月27日以降のデータ。コース(A~E)・馬場周り(右/左)・最大2000Mまでの区間タイム/ラップタイムを収録
- HC/WCいずれも血統登録番号は「生年(西暦)4桁+品種1桁+数字5桁」の10桁形式 — [scripts/netkeiba/README.md](../scripts/netkeiba/README.md)で「要検証」としていたnetkeiba馬ID(10桁)と`horses.jv_horse_id`の一致仮説を補強する材料になる (両者とも同じ採番規則の血統登録番号であるため)

**JVOpenのoption/dataspec制約 (要注意、2026-07-10追加調査)** — JV-Linkインターフェース仕様書 Ver.4.9.0.1 (`https://jra-van.jp/dlb/sdv/sdk/JV-Link4901.pdf`) のJVOpenパラメータ説明で確認:

| option | 用途 | dataspecに指定可能なデータ種別ID |
|---|---|---|
| 1 (通常データ) | 蓄積系ソフトの差分メンテナンス | TOKU, RACE, DIFF, BLOD, SNAP, **SLOP, WOOD**, YSCH, HOSE, HOYU, DIFN, BLDN, SNPN, HOSN |
| 2 (今週データ) | 非蓄積系ソフトの当週データのみ取得 (軽量) | TOKU, RACE, TCOV, RCOV, SNAP, TCVN, RCVN, SNPN (**SLOP/WOODは含まれない**) |
| 3, 4 (セットアップ) | 初回一括取得 | TOKU, RACE, DIFF, BLOD, SNAP, **SLOP, WOOD**, YSCH, HOSE, HOYU, COMM, MING, DIFN, BLDN, SNPN, HOSN |

- **SLOP/WOODはoption=2では取得不可。option=1(通常データ)またはoption=3/4(セットアップ)でのみ取得できる**
- このアプリは「蓄積系ソフト」(継続的にSupabaseへ溜め込む設計) なのでoption=1が自然な選択であり、軽量な今週データ取得(option=2)を使い分けている場合は、SLOP/WOOD用に別途option=1でのJVOpen呼び出しが必要になる (レース系データと同じ呼び出しにはまとめられない)
- dataspecは4桁固定のデータ種別IDを連結した文字列 (例: `"RACESLOPWOOD"`)。fromtimeは`YYYYMMDDhhmmss-YYYYMMDDhhmmss`形式で範囲指定可能 (SLOP/WOODは終了時刻指定の対象外リストに入っていないため、範囲指定に対応)

**✅ training_sessionsを再設計・実装済み (2026-07-10、`supabase/migrations/20260710070000_redesign_pedigree_training_stats.sql`)。** 旧設計(course_type/time_sec/time_interval等の汎用フリーテキスト)を作り直し、HC/WCの実際のフィールド構造に合わせた:
- `training_type`('坂路'|'ウッドチップ')・`facility`('美浦'|'栗東')・`course_code`(ウッドチップのみ、A〜E)・`turn_direction`(ウッドチップのみ)
- `lap_times_sec`(jsonb) — ゴール手前メートル数をキーにした200M刻みのラップタイム(例: `{"800": 52.3, "600": 38.1, "400": 24.0, "200": 12.1}`)。区間数がHC/WCで異なり将来の仕様変更もありうるため固定カラムにせずJSONBにした
- `total_time_sec` — 集計・ソート用に主要区間合計を非正規化して保持
- `trainer_name` — 調教時点の管理調教師のスナップショット(下記の厩舎単位ベースライン集計のため。horses.trainer_nameは「現在の」管理調教師のみで乗り替わり履歴を追えないため別途保持)
- **未実装(次回以降):** 厩舎単位・馬個体単位の「本気パターン」ベースライン自体は、まだ集計クエリ/ビューとして実装していない(テーブル設計のみ完了)。実装時はtraining_sessionsを`trainer_name`または`horse_id`でグルーピングし、`total_time_sec`の分布(平均・偏差)に対する各セッションの相対位置で判断する設計にする

netkeibaは追い切りデータの取得元として使わない (JV-Data優先原則の通り、HC/WCで代替できるため)。

**調教評価の設計方針 (2026-07-10、ユーザーからの指摘)**: 調教タイムは単純な絶対値では良し悪しを判断できない (馬場状態・併せ馬・気配等に左右されるため)。むしろ以下の相対比較が重要な判断材料になる。
- その調教師の「本気パターン」との比較 (普段より時計が良い/併せ馬が強い等、厩舎ごとの「仕上げてきた」サインの学習)
- その馬自身の過去の調教タイムとの比較 (絶対値ではなく自己ベース比での良し悪し)

これは既存の「予想軸の拡張方針」節の「厩舎ごとの追い切りパターン学習」と同じ発想。上記の通りテーブル構造はこの相対比較ができる形に再設計済みだが、実際の集計ロジック(ベースライン算出クエリ・prediction_criteriaへの接続)はまだ実装していない。

### 血統データソースの確定 (2026-07-10調査)

**JV-Data (JV-Link) に血統専用のデータ種別「BLOD」(蓄積系ソフト用 血統情報) があり、3代血統の血統樹を追加費用なしで取得できることを確認済み。** ただし種牡馬ごとの集計済み成績・回収率統計はJV-Dataには含まれず、外部ソースかこのアプリでの自前集計が必要。

**JV-DataのBLOD (確定、無料・契約範囲内)**

JV-Data仕様書 Ver.4.9.0.1の「データ種別一覧」で確認:
- **繁殖馬マスタ** (レコードID: `HN`) — 1986年以降。馬名・生年・性別・毛色・産地に加え、父馬/母馬の繁殖登録番号 (さらに遡れるリンク) を保有
- **産駒マスタ** (レコードID: `SK`) — 1986年以降。**3代血統 (父･母･父父･父母･母父･母母･父父父･父父母･父母父･父母母･母父父･母父母･母母父･母母母の14頭分の繁殖登録番号)** を1レコードで保有。現状の`horses`テーブル(sire_name/dam_name/dam_sire_nameの1世代のみ)より深い血統樹が無料で取れる
- どちらも`option=1`(通常データ)・`option=3,4`(セットアップ)に含まれ、調教データ(SLOP/WOOD)と同様に追加契約不要

**種牡馬別成績・配合パターン(ニックス)の集計統計は別問題 (要判断)**

BLODは血統の「関係」(who's the sire/damという構造)のみで、「父◯◯の産駒は芝1600mで複勝率◯%」のような集計済み統計は含まれない。この集計は外部から取得するか自前で作る必要があり、候補を検討した結果:

- **JBISサーチ (jbis.or.jp)**: 種牡馬別成績等を保有するが、サイトポリシーで「有償無償に拘らず営業活動、営利を目的とした利用及びその準備を目的とした利用をすることは一切できません」と明記されている。「業務利用・二次利用について」ページを確認したが、個人開発アプリ向けの申請フローの記載はなく、利用したい場合はJBBAへの個別問い合わせと明示的な許諾が前提になる。**現時点ではスクレイピング等での利用は見送り推奨** (netkeibaと同様のToSリスク)
- **ジャパン・スタッドブック・インターナショナル (studbook.jp)**: 公益財団法人運営の公式血統登録機関のサイト。利用規約の詳細(商用利用可否)は未確認だが、公的な血統登録データベースという性質上JBIS同様に制限がある可能性が高い。要問い合わせ
- **一口馬主DB「ニックス診断」(umadb.com)**: 配合パターン評価に直接使えそうだが、利用規約未確認

**推奨方針**: 種牡馬別成績・配合パターンの回収率ベース分析(穴馬推奨に使いたい機能)は、外部サイトのスクレイピングに頼らず、**自前で計算する**方針を軸にする。BLODで血統樹を持ち、past_performances(odds_win等を含む、蓄積が進めば自レースのオッズ実績も)と組み合わせて、種牡馬×距離帯/馬場/コースごとの成績・回収率を自分たちで集計する。ただしこれは相応の蓄積期間 (数年分のレースデータ) が必要で、トラックバイアスの「毎年同じ開催」参照と同様、運用開始直後はデータが薄い制約がある。外部データで即座に厚みを持たせたい場合は、JBISへの正式な利用許諾の問い合わせを別途検討する

⚠️ netkeibaのアンチスクレイピング対策の詳細と対応方針は上記「netkeibaアンチスクレイピング対策の詳細と対応方針」を参照。

**✅ 血統・種牡馬統計テーブルを再設計・実装済み (2026-07-10、`supabase/migrations/20260710070000_redesign_pedigree_training_stats.sql`)**

- **`horse_pedigrees`(新設)** — BLOD「産駒マスタ(SK)」準拠の3代血統14頭分(父/母/父父/父母/母父/母母/父父父/父父母/父母父/父母母/母父父/母父母/母母父/母母母)を1馬1行で保持。種牡馬・繁殖牝馬自体は`horses`に行を持つとは限らない(海外種牡馬・引退済み等)ためFKにはせず自由記述のtextで保持。`horses.sire_name`/`dam_name`/`dam_sire_name`(1〜2世代の簡易参照)は既存コード互換のためそのまま残し、深い血統樹はこちらで別管理する併存構成
- **`sire_stats`/`nick_stats`に`roi_win_pct`(単勝回収率%)を追加** — 「オッズ妙味の評価」方針(的中率でなく回収率で判断)に合わせ、win_rate/place_rateだけでなくROIを主指標にできるようにした
- **`nick_stats`にsire_statsと同じ`stat_category`/`stat_key`(distance_band/track_type/course)のセグメントを追加** — 従来は父×母父の通算成績のみで、条件別の配合傾向を見られなかった不整合を解消
- **✅ 診断プロンプトへの配線完了 (2026-07-10)** — `route.ts`の`loadRaceDiagnosisInput`が`horse_pedigrees`(1:1)・`training_sessions`(馬ごと直近3件)・`sire_stats`/`nick_stats`(horses.sire_name/dam_sire_nameのtextマッチ)を取得し、`prompts.ts`の`EntryDiagnosisInput`に追加(`pedigree`/`trainingSessions`/`sireStats`/`nickStats`)。`serializeEntry`経由で`buildRaceDataPayload`にも含まれるようになった。`CORE_RULES`に「血統・調教データの扱い」節を追加し、血統はsire_stats/nick_statsのroi_win_pct(starts10未満は参考程度)、調教はlap_times_secの末脚タイムを自己ベース比で判断する方針を明記した。`prediction_criteria`経由のスコア化ではなく、past_performancesと同様に生データをそのままLLMに渡して都度判断させる設計(既存のserializeEntry方式と統一)
- **未実装(次回以降):** (1) BLOD由来の実データ投入(JV-Link接続後)、(2) past_performances蓄積からsire_stats/nick_statsのroi_win_pct等を実際に算出する集計バッチ、(3) 厩舎(trainer_name)単位の調教ベースライン算出クエリ。今はテーブルはあってもレコードが0件のため、実際に診断へ渡してもデータが空という状態(配線自体は完了)

### 実際の回収率トラッキングの追加 (2026-07-10、スキーマレビューで発見したギャップ)

**ギャップ:** アプリ全体で「回収率重視」を掲げているにもかかわらず、確定後の実際の配当・honmei/aite推奨が的中したかを記録するテーブルが一つも存在しなかった。`races.honmei_horse_number`等は診断が出した予想のスナップショットとしては残るが、それが実際どうなったか(的中/回収額/ROI)を追跡する仕組みが無く、**このアプリ自体の実運用回収率を検証できない状態**だった。

**追加したテーブル (`supabase/migrations/20260710080000_add_payouts_and_recommendation_tracking.sql`、まだSupabaseへの適用は未実施):**

- **`race_payouts`(新設)** — レース確定後の実際の払戻金 (単勝/複勝/枠連/馬連/ワイド/馬単/三連複/三連単、馬番の組み合わせ、100円あたりの払戻金)。**✅ 解消(2026-07-11):** JV-Dataの配当情報レコード(`JV_HR_PAY`、レコード種別`HR`)のバイトオフセットを`JVData_Struct.cs`で確認し、`scripts/jvlink/parse_records.py`に`parse_hr()`を実装・`PARSERS`へ登録した(詳細は`scripts/jvlink/README.md`の「各修正の反映状況」8番)。2026-07-04開催の函館1R・福島5Rの実データをnetkeibaの結果ページと突き合わせ、単勝・複勝・枠連・馬連・馬単・3連複・3連単は組み合わせ・払戻金額・人気順が完全一致することを確認済み。**⚠️唯一の既知差異:** ワイドの2・3番目の組み合わせの人気順のみnetkeiba表示と±1ずれる(組み合わせ・金額自体は一致)。**次のステップ:** `HR_parsed.csv`(列名は`{bet_type}_combination{n}`/`{bet_type}_payout_yen{n}`/`{bet_type}_ninki{n}`のスネークケース)を受け取ってMac側`load_to_supabase.py`に`race_payouts`へのupsertを追加する作業がまだ
- **`race_recommendation_results`(新設)** — 診断が出したhonmei/aite推奨(bet_type・馬番・stake_yen)と、実際に的中したか(is_hit)・払戻額(return_yen)・回収率(roi_pct)を記録する。races側のhonmei_horse_number等は再診断で上書きされうるため、「その時点で実際に賭けた想定の推奨」を別途スナップショットとして残す設計
- **未実装(次回以降):** レース確定後に`race_payouts`と`races`の推奨内容を突き合わせて`race_recommendation_results`を計算するバッチは未実装。これが無いと「このアプリの予想は実際何%儲かっているか」を示すダッシュボード的な機能は作れない。JV-Link接続・実データ投入が前提になるため、当面は設計のみ

## 予想軸の拡張方針 (重要な設計方針)

現在の予想軸 (絶対能力・ペース位置取り不利・トラックバイアス・ブリンカー等装備変更・騎手要因・枠順データ) は固定ではない。以下2点を設計・運用の前提とする。

1. **予想軸を自由に追加/変更/削除できる設計にする。** 現状の4テーブル (races / horses / race_entries / past_performances、`supabase/migrations/20260708000000_init_schema.sql`) を崩さない範囲で、将来的に `prediction_criteria` (予想軸マスタ) のようなテーブルを追加できる余地を残すこと。個別の予想軸をraces/race_entriesの固定カラムに直接ハードコードして増やしていく設計は避け、軸の追加がスキーマ変更を伴わずに済む拡張ポイントを意識する (例: 予想軸マスタ + 軸ごとのスコア/根拠を紐付ける中間テーブル、またはJSONBでの柔軟な保持など。具体的な実装は次回のDBスキーマ詳細調整で検討する)。
2. **予想軸の追加・変更・削除はユーザーからの指示だけでなく、Claude側からも積極的に提案する。** データを見ていく中で「この軸を追加すると精度が上がりそうだ」と判断した場合は、回収率向上につながりそうな軸の追加・削除を能動的に提案すること。ユーザーの指示を待つだけの受け身の姿勢にしない。

### 追加候補の予想軸 (2026-07-08時点、拡張方針の具体例)

- **厩舎ごとの追い切りパターン学習**: 坂路/ウッドチップ/コースなど調教種別ごとの、厩舎による時計の出し方の傾向を過去データから学習できる形にする
- **厩舎×騎手の組み合わせパターン**: 「普段と違う騎手を配置している＝本気」のような、厩舎と騎手の組み合わせの過去傾向を拾えるようにする
  - 上記2点は `prediction_criteria` 拡張時に、馬ごとの追い切りセッション(日付・調教種別・時計・併せ馬情報等)や厩舎×騎手の起用履歴を保持できるテーブル設計が必要になる見込み
- **血統評価**: 父・母父の産駒傾向(得意距離・馬場・コース適性)や配合パターン(ニックス)を過去データから学習し、予想に反映する
  - `prediction_criteria` 拡張時に、種牡馬/母父ごとの産駒成績集計(距離帯別・馬場別・コース別の成績)や配合パターン(父×母父の組み合わせ別成績)を保持できるテーブル設計が必要になる見込み。horsesテーブルのsire_name/dam_sire_nameを起点に集計する形が考えられる
- いずれもDBスキーマ詳細調整のタイミングで検討する

## 開発ステータス

### 完了 (2026-07-08時点)

- Next.jsプロジェクト初期セットアップ (TypeScript, Tailwind, App Router)
- Supabase接続 (`src/lib/supabase/client.ts` / `server.ts` / `admin.ts` / `session.ts`)、`.env.local`に実際の認証情報設定済み、疎通確認済み
- Claude API呼び出しの基本構造 (`src/lib/claude/client.ts` / `predict.ts`)、モデル階層 (Haiku 4.5 / Sonnet 5 / Opus 4.8) で疎通確認済み
- `src/proxy.ts` (Next.js 16の`middleware.ts`後継) でセッションrefresh
- DBスキーマ初期案: races / horses / race_entries / past_performances の4テーブル (`supabase/migrations/20260708000000_init_schema.sql`)、対応する`database.types.ts`
- DBスキーマ詳細調整 (2026-07-10) — 既存4テーブルは維持しつつ、`prediction_criteria`(予想軸マスタ)+`race_entry_criteria_scores`/`race_criteria_scores`(軸ごとのスコア中間テーブル、馬単位/レース単位で分離)で軸の追加をスキーマ変更なしで可能にした。加えて`training_sessions`(追い切りセッション記録)、`sire_stats`/`nick_stats`(血統の産駒成績・配合パターン集計、`horses.sire_name`/`dam_sire_name`とテキストマッチで参照)を追加。細かい修正として`races.bias_reference_race_id`の自己参照FKに`on delete set null`を付与、`horses.sire_name`/`dam_sire_name`にインデックス追加。厩舎×騎手の組み合わせパターンは既存`race_entries`+`horses`の集計で足りるため専用テーブルは設けない判断とした。`database.types.ts`にも対応する型を追加済み
- Supabaseへのマイグレーション適用 (2026-07-10) — `supabase/migrations/20260708000000_init_schema.sql`(10テーブル)をSupabaseプロジェクト「Keibalover」(`otmxouhgxtcnnzhmkoft`)に適用済み。`npx supabase gen types typescript`で型定義を正式生成し、`database.types.ts`をCHECK制約由来のUnion型と組み合わせる形に更新
- Vercelデプロイ (2026-07-10) — プロジェクト`maroyutas-projects/keiba-app`を作成・リンク、`.env.local`の4項目(`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`ANTHROPIC_API_KEY`)をProduction/Preview/Development全環境に登録、初回本番デプロイ完了。公開URL: https://keiba-app-lovat.vercel.app (200 OK確認済み)
- 予想ロジックのプロンプト設計 (2026-07-10) — `src/lib/claude/prompts.ts`に3本柱+おまけ・レース投資判断・枠順消し判定・夏競馬バイアス・馬券方針・拡張予想軸の織り込みルールを`DIAGNOSIS_SYSTEM_PROMPT`(標準/プレミアム共通)と`SCREENING_SYSTEM_PROMPT`(一次スクリーニング用の簡易版)として実装。出力はDBスキーマ(races/race_entriesの該当カラム)に1:1対応するJSON形式に固定し、`predict.ts`側でパースする設計にした。予想軸の追加提案 (`suggested_criteria`) もルールとして出力契約に組み込み済み。`buildRaceDataPayload()`がrace/horses/race_entries/past_performances/criteria_scoresをペイロード化する。`tsc --noEmit`・`eslint`・`next build`で確認済み
- netkeibaデータ取得部分の実装 (2026-07-10) — `scripts/netkeiba/`にWindows PC側バッチ用のスクリプト一式を実装。詳細は[scripts/netkeiba/README.md](../scripts/netkeiba/README.md)参照
  - `httpClient.ts`: 正直なUser-Agent・5秒以上のリクエスト間隔・例外を投げず`null`を返すグレースフルデグラデーション
  - `parseRaceResult.ts`: `race.netkeiba.com/race/result.html`の実HTML (2026-07時点、race_id=202610010301の小倉1Rで検証済み) をcheerioでパース。着順・タイム・オッズ・人気・上がり3F・コーナー通過順・ペース(S/M/H)・馬体重増減等を抽出
  - `syncPastPerformances.ts`: netkeiba馬ID(`/horse/`のURL中の10桁)を`horses.jv_horse_id`と同一とみなしてマッチングし(**要検証の前提**)、`past_performances`(`data_source: 'netkeiba'`)へupsert。未登録馬はスキップしてログに残し処理継続
  - `npm run sync:netkeiba -- <race_id> [<race_id> ...]`で実行 (`tsx`導入済み)。Windows PCでのタスクスケジューラ設定自体は未実施
  - 既知の制約: 着差の秒換算は馬身表記からの概算、グレード抽出は`Icon_GradeType`依存で重賞での動作は未検証、netkeibaのマークアップ変更で壊れる可能性がある
- 予想生成のAPI Route実装 (2026-07-10) — [src/app/api/races/[raceId]/diagnose/route.ts](../src/app/api/races/[raceId]/diagnose/route.ts)を実装。Supabaseからrace/race_entries/horses/past_performances(直近5走)/拡張予想軸スコアを取得して`RaceDiagnosisInput`に変換し、screenRace(Haiku)でC評価なら打ち切り、それ以外はdiagnoseRaceStandard(Sonnet)、その結果がS評価の場合のみdiagnoseRacePremium(Opus)へ再診断させるモデル階層のエスカレーションを実装。結果はraces/race_entriesへ書き戻す。`suggested_criteria`(予想軸の追加提案)はDBへ自動登録せずAPIレスポンスに含めるのみ (人間のレビューを挟む設計)。`tsc --noEmit`・`eslint`・`next build`・ローカルdevサーバーでの404疎通確認済み。実際のレースデータでの診断実行 (Claude APIの実呼び出し) は未検証

- 実データでの診断テスト (2026-07-10) — `scripts/seed-test-race.ts`(netkeiba race_id=202610010301の実データ)でraces/horses/race_entriesを投入し、`/api/races/[raceId]/diagnose`を実際に叩いて疎通確認。
  - screening(Haiku)経路: races.race_rank/race_rank_reasonへの書き戻しまで2パターン(過去成績なし/`scripts/seed-test-past-performances.ts`で架空の過去成績7件を投入した状態)で確認。いずれもオッズが辛く回収率が低いという妥当な理由でC評価となり、standard/premiumへは自然遷移しなかった
  - standard診断(Sonnet)経路: screeningのC評価では到達しないため、`diagnoseRaceStandard`を直接呼び出す形で検証(使い捨てスクリプトは検証後削除済み)。14頭分の複雑なJSON応答が正しくパースされ、race_rank=B、S~Cランク付け・kesshi判定・本命/相手選定・馬券方針・5項目分析・`suggested_criteria`(予想軸の追加提案が実際に機能することも確認)まで期待通り出力され、races 1件 + race_entries 14/14件がDBに正しく書き戻されることを確認した
  - premium診断(Opus)経路は未検証 (standardと同じJSON契約のため構造的には検証済みとみなせるが、実呼び出しはまだ)
  - `scripts/seed-test-race.ts` / `scripts/seed-test-past-performances.ts` は開発用シードとしてリポジトリに残置。投入先レースID: `a7fa5a36-b082-48f9-be47-a652ac65b314`

- フロントエンド (診断表UI) (2026-07-10) — `src/app/races/[raceId]/page.tsx`を実装。レースヘッダー(場・R番・レース名・日付・条件)、race_rankバッジ(S=金/A=緑/B=青/C=グレー、`RANK_BADGE_STYLES`)、買い目(本命→相手・券種)、出走馬テーブル(枠・馬番・馬名・人気(オッズ)・ランク・短評、消し馬は取り消し線相当の半透明+「消」表示)、全体分析5項目を表示。Supabaseからの読み取りは`createAdminClient()`を使用 (認証UIが未実装のため。RLSは`auth.role() = 'authenticated'`前提でこのアプリには当面該当しない)。実際に投入済みのテストレース(`a7fa5a36-b082-48f9-be47-a652ac65b314`)でSSR出力を検証し、14頭全てのランク・短評・消し判定・全体分析が正しく表示されることを確認済み。`src/app/page.tsx`/`layout.tsx`もCreate Next Appのデフォルトから最小限のプレースホルダーに置き換えた
  - ※Chromeでの実ブラウザ描画確認 (色・レイアウト) は環境制約により未実施。SSR HTML出力とTailwindクラスの付与のみ確認済み

- 想定トラックバイアス・展開予測の明示化 (2026-07-10) — `DiagnosisResult`に`predicted_bias`(想定トラックバイアス)を追加し、races.bias_noteへ書き戻すようにした。`analysis_pace`も「前残り/差し決着のどちらが有力か」を明言する指示に強化。`diagnoseRaceStandard`の実呼び出しで動作確認済み (例: 「小倉ダート1000mは直線が短く内枠・先行馬絶対有利。差し・追い込みは届きにくく...」という具体的な出力を確認)。診断表UI (`src/app/races/[raceId]/page.tsx`) にも`race.bias_note`の表示を追加済み
- バイアス予測の参照データ機構 (2026-07-10) — トラックバイアスはその時々の馬場状態次第で変わるため、`route.ts`に`findBiasReferenceRace()`を実装。土曜のレースは直近の同場開催 (基本的に先週の同場、`races`テーブルから`keibajo_code`一致・`bias_note`が既に入っている直近レースを検索)、日曜のレースは前日 (土曜) の同場レースを参照レースとして自動検索し、`RaceDiagnosisInput.biasReferenceRace`として診断プロンプトに渡す。見つかった参照レースのIDは`races.bias_reference_race_id`に書き戻す (screening C評価の早期打ち切り経路でも書き戻す)。参照データが存在しない場合 (運用開始直後・開催初週等) はnullを渡し、プロンプト側で「参照データはないが一般論として」と明示させる設計。実際に、参照データなし/ありの両パターンで動作確認済み — 参照データありのケースでは「先週(1/24)の小倉開催は雨で外差し優勢だったが、今回は良馬場でコンディション回復傾向のため...」のように、条件の変化まで踏まえた推論が出力されることを確認した
  - ※「毎年同じ開催 (前年以前の同時期開催) からの参照」は未実装。現状は`races`テーブルに蓄積された直近データのみを参照するため、運用開始直後や新規開催地では参照データが手に入らない。複数年分の履歴データを蓄積・参照する仕組みは将来の課題
- レース一覧・診断ボタンの実装 (2026-07-10) — raceIdを知らないとAPIを直接叩くしかなかった問題を解消。
  - `src/app/races/page.tsx`: 全レースを`race_date`降順で一覧表示。`race_rank`バッジ付き
  - `src/app/races/[raceId]/DiagnoseButton.tsx`: 「診断する」/「再診断する」ボタン (Client Component)。`/api/races/[raceId]/diagnose`をPOSTし、成功後`router.refresh()`でServer Componentを再描画。ローディング中は「診断中… (最大1分ほどかかります)」を表示、失敗時はエラーメッセージを表示
  - `RankBadge`を`src/app/races/RankBadge.tsx`に切り出し、一覧・詳細ページで共有
  - ルート`page.tsx`にレース一覧への導線を追加
  - `route.ts`に`export const maxDuration`を追加
  - 実際に本番コードパス(ボタンと同じAPI)でscreening C評価時の`bias_reference_race_id`書き戻しまで確認。standard診断到達時の`bias_note`書き戻しは、今回はC評価で打ち切られたため未検証 (ロジック自体は既存のstandard診断テストで検証済みの`predicted_bias`をそのままrace.bias_noteに渡すだけの単純な配線)
- Vercel本番への再デプロイ (2026-07-10) — レース一覧・診断ボタン等の最新コードを反映。公開URL: https://keiba-app-lovat.vercel.app/races (一覧) / https://keiba-app-lovat.vercel.app/races/a7fa5a36-b082-48f9-be47-a652ac65b314 (詳細・診断ボタン)。実ブラウザでの見た目確認はこのURLから可能
- premium(Opus)診断経路の実呼び出し検証 (2026-07-10) — `diagnoseRacePremium`を直接呼び出して検証(使い捨てスクリプトは検証後削除済み)。**実測で198秒(3分強)かかった。** JSON応答は正しくパースされ、races 1件 + race_entries 14/14件のDB書き戻しも成功。過剰人気馬(1番人気7番、オッズ1.7倍)を「妙味なし」として相手側に格下げし、より配当妙味のある5番を本命に選ぶなど、回収率重視のルールがstandardより踏み込んで反映された出力を確認。`suggested_criteria`(テン3F/初速スコア、馬体重の絶対値と増減幅)も機能
  - **⚠️重要な発見: Vercel Hobbyプランはmaxduration上限が60秒で固定であり、premium診断(約200秒)は確実にタイムアウトする。** Proプラン(300秒、Fluid Computeで800秒まで延長可)への切り替えが実質必須。`route.ts`の`maxDuration`は300に設定したが、Hobbyプランのままだと実際には60秒でハードタイムアウトする点に注意 (現在のVercelプランは未確認)

- API使用量の実測ログ機構 (2026-07-10) — `api_usage_log`テーブルを追加し、`predict.ts`の3関数(screenRace/diagnoseRaceStandard/diagnoseRacePremium)が`{result, usage}`を返すよう変更。`route.ts`が診断のたびに実際のinput/output tokens・推定コスト(USD/円換算)をDBに記録する。単価はHaiku 4.5 $1/$5、Sonnet 5 $2/$10(2026-08-31までのintro価格、以降$3/$15)、Opus 4.8 $5/$25 (per 1Mトークン)。**adaptive thinkingのトークンは別立てではなく通常のoutputトークンと同じ単価で課金される**点が肝
  - **実測値 (テストレース1件、2026-07-10):**
    - screening (Haiku): input=5785, output=203 → **$0.0068 (≈¥1.0)**
    - standard (Sonnet, high effort): input=8402, output=6010 (adaptive thinking込み) → **$0.0769 (≈¥11.5)**
    - premium (Opus, xhigh effort) の実測usageはまだ未取得 (以前の検証時はusageログ実装前だったため、198秒かかったことのみ判明。$0.40~0.83/回程度と推定されるが未確定)
  - この実測値からの概算: 全35レース/日をscreeningし、Cで弾かれなかった~15レースをstandardまで進めると、screening ¥35/日(35レース×¥1.0) + standard ¥172/日(15レース×¥11.5) ≈ **月換算で約6,000円程度**(premium抜き)。当初の月4,500~12,000円という概算より、少なくともscreening+standard部分は下振れしそうな実測結果
  - **⚠️誤解注意:** ¥172は「standard 1レースあたりの単価」ではなく「standard対象15レース分の1日あたり合計」。standardの単価は¥11.5/レース。premiumは実測未取得だが$0.40~0.83/回(≈¥60~125/回、150円/$換算)という推定であり、¥20/回や¥172/回という数字ではない
  - **新馬・障害を対象外にした場合の再概算 (2026-07-10、実際の比率は未計測につき概算):** JRAの一般的な開催構成から新馬・障害は合わせて35レース中5~8レース程度(シーズンや開催場により変動)と仮定すると、除外後は screening+standardの合計が約15~25%減り、月換算で概ね¥4,500~5,200円程度になる見込み。**⚠️訂正 (2026-07-10):** 「screeningでC評価のレースをstandardまで進めずそこで打ち切る」は当初コスト削減レバーとして提示したが、実際には`route.ts`は元からC評価で打ち切る実装であり、上記¥6,000/月・¥4,500~5,200/月の見積もりは元々この打ち切り込みの数字だった。つまりこの決定(打ち切り維持)によるコストの追加削減効果は無い(「全部standardまで回す」という逆方向の変更を採用しなかっただけ)。¥4,000/月ちょうどに収めるには新馬・障害除外以外の追加レバー(premiumの手動化・screening基準の厳格化等)が必要。実際の新馬・障害の比率とC評価の分布は、実データ(JV-Link同期後)で計測してから最終確定すること

### 次回やること

1. **premium(Opus)の実測usage取得の判断** — Opusは他より高コストなため、実測を取るかどうかユーザーに確認してから実行する
2. **¥4,000/月ターゲットの検証** — 新馬・障害除外(実装済み)とpremium手動化(実装済み、上記)により、screening+standardは月¥4,500~5,200円程度、premiumは手動実行分のみ(実測usage取得後に正確な単価が判明)という構成になった。実際に月¥4,000に収まるかは、新馬・障害の実際の比率と「本気診断」ボタンの月間実行回数次第なので、実運用しながら`api_usage_log`で計測すること
3. **新馬・障害除外ロジック / 本気診断ボタンの動作確認** — node/npm環境がある場所で`tsc --noEmit`・`next build`を実行し型エラーがないことを確認し、実ブラウザで「本気診断する」ボタンがS評価のレースにのみ表示されること・S以外で叩いても400になることを確認する(このセッションのサンドボックスでは未実施)
4. **実ブラウザでの見た目確認** — `/races`・`/races/[raceId]`をスマホ幅で実際にレンダリングし、カラーコード・ボタンの見え方・横スクロール表組みを確認する
5. **✅ 新設マイグレーション(`20260710070000_redesign_pedigree_training_stats.sql`)はSQL Editorで適用済み (2026-07-10)。** `horse_pedigrees`/`nick_stats`/`training_sessions`の存在と`sire_stats.roi_win_pct`列をクエリで確認済み。**残タスク:** `npm run build`(型チェック込み)はこのセッションにnode環境が無く未実施。node環境のあるターミナルで実行し、エラーが無いか確認すること
6. **✅ 診断プロンプトへの配線は完了 (2026-07-10、上記「血統データソースの確定」参照)。** 残るのは(a) JV-Link接続後の実データ投入、(b) past_performances蓄積からのROI等の実集計バッチ、(c) 厩舎単位の調教ベースライン算出クエリ。今はテーブルが空のため、配線済みでも診断結果への実際の影響はまだ無い。運用初期はデータが薄い制約もあるため、当面は「穴馬推奨」機能の精度は限定的になる前提で進める
7. **新設マイグレーション(`20260710080000_add_payouts_and_recommendation_tracking.sql`)をSupabase SQL Editorで適用する** — `race_payouts`/`race_recommendation_results`を追加(上記「実際の回収率トラッキングの追加」参照)。前回同様、SQL Editorに貼って実行し、`select table_name from information_schema.tables where table_name in ('race_payouts', 'race_recommendation_results');`で2行返ることを確認する
8. **✅ 配当情報のレコード種別は「HR」と判明(2026-07-11、Web検索で確認)。** 単勝/複勝/枠連/馬連/ワイド/馬単/三連複/三連単それぞれの払戻金額・組み合わせを保持しており、`race_payouts`テーブルの仮設計(bet_type enum)は方向性として正しいことを確認できた。**ただし正確なフィールド構造(バイトオフセット)までは未確認。** RA/SE/JGと同様、Windows側で`JVData_Struct.cs`と突き合わせて`parse_records.py`にHRパーサーを追加するのが確実(次回バックテスト着手前にこれが必要)
9. **race_recommendation_results算出バッチの実装** — レース確定後に`race_payouts`と`races`の推奨内容を突き合わせて的中・回収率を計算する処理。JV-Link接続・実データ投入が前提
10. **✅ `/dashboard`(回収率ダッシュボード)を実装済み (2026-07-10)。** 下記「回収率ダッシュボード」参照。**未検証:** node環境が無く`npm run build`未実施。特に`race_recommendation_results`の`races(...)`ネスト埋め込みselectの型付けと、Tailwindの`line-clamp-1`(v4なら標準対応のはずだがバージョン未確認)は要注意ポイント
11. **反省ログの構造化 (将来案、未着手)** — 「AIが不利だと判断して評価を上げた馬が実際は走らなかった」のようなパターンを能動的に学習するには、`race_rank_reason`/`horse_rank_comment`のような自由文だけでなく、診断時にLLM自身が`race_entry_criteria_scores`へ構造化タグ(例: 「出遅れ」「包まれ」等の不利要因ごとのスコア)を書き込む必要がある。現状は`criteria_scores`を入力として読むだけで、診断のたびにLLMが書き込む経路が無い。実装すれば「特定の不利判定タグが付いた馬の実際の的中率」を`race_entry_criteria_scores`×`race_entries.finish_position`で集計でき、ダッシュボードの個別レース一覧より一段深い分析ができる

### 回収率ダッシュボード (2026-07-10実装)

`/dashboard`ページ(`src/app/dashboard/page.tsx`)。`race_recommendation_results`(`computed_at`が入っている＝確定済みの行のみ)を集計して表示する。ユーザーの要望「大まかにも細かくも見たい、初めから細かいと見にくい」を踏まえた3段階構成:

1. **サマリーカード(最も大まか)** — 総合回収率・的中率・購入レース数
2. **期間別推移(中間)** — `RoiTimeSeriesChart.tsx`(Client Component)。週/月/年をボタンで切り替え可能なSVG棒グラフ、デフォルトは月次(大まか寄り)。回収率100%の損益分岐線を破線で表示、100%以上は緑(emerald)・未満は赤(red)
3. **項目別テーブル(中間〜細かい、2026-07-10改修)** — `BreakdownTable.tsx`(Client Component)。ユーザーが提示したnetkeiba「My収支」画面と同じ列構成(回収率/的中率/購入金額/払戻金額/購入R数/的中R数)のテーブルを、「ランク別」「競馬場別」「買い方別」の3タブで切り替えて見られるようにした。ランク別は`race_recommendation_results.race_rank`(確定時点のスナップショット)、競馬場別は`races.keibajo_name`、買い方別は`bet_type`(wide/umaren/both)でグルーピング。並び順は購入金額の多い順(netkeibaと同じ)
4. **個別レース一覧(最も細かい、振り返り用)** — `RecommendationList.tsx`(Client Component)。的中/外れで絞り込めるので、「外れのみ」表示にして`race_rank_reason`(短評)を見比べれば、外れたレースの予想根拠を素早く振り返れる

**新しい依存ライブラリは追加していない**(recharts等は未導入、SVGを手書き)。node環境が無くても`npm install`無しでビルドできる想定。

**この画面が意味のあるデータを表示するには、次回やることの7〜9(payoutsマイグレーション適用・JV-Data配当調査・算出バッチ実装)が前提として必要。** 今は空の状態(「確定した推奨結果がまだありません」というメッセージ)で表示されるはず。
