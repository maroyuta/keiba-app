<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 競馬予想Webアプリ

## ⏸️ 引き継ぎ中の相談 (2026-07-10、ここから再開)

直前のセッションがコンテキスト逼迫で終了。以下の質問にユーザーはまだ回答していない。次回セッションはここから会話を再開すること:

1. **premium(Opus)診断の実測usageを取るか?** — Opusは高コストなので、実測を取る前にユーザーに確認する約束をしていた(screening/standardは実測済み、下記参照)
2. **コスト最適化の設計方針(提案済み・未承認):**
   - 未勝利・新馬戦はOpusへエスカレーションさせずSonnet止まりにする
   - screeningでCと出たレースもstandard(Sonnet)までは回して精度検証データを蓄積する(「たくさん予想して精度を見たい」というユーザーの要望に対応)
   - 実際に「買う」判断のためのOpus深掘りは自動エスカレーションではなく、手動の「本気診断」ボタンに変える(既存の「再診断する」ボタンを流用/分離)
   - 背景: ユーザーは月¥12,000のコストは払いたくない、実際に買うのは~5レース/日程度、という制約から出発した相談

**⚠️ gitに一切コミットしていない。** このセッションで実装した内容(DBスキーマ、予想エンジン、netkeibaスクレイパー、フロントエンド、使用量ログ機構など)は全て未コミットのworking tree差分。作業を始める前に`git status`を確認し、必要なら先にコミットすることを検討する。

## 全体構成

- Windows PC上のJV-LinkがJRAデータを定期取得し、Supabaseへ自動同期する(このリポジトリの外側の処理)
- 本アプリはスマホから使う予想インターフェース (Next.js, Vercelホスティング)
- 予想生成はClaude APIを直接呼び出す (`src/lib/claude/`)。チャット使用量上限の制約を受けない

## モデル階層 (コスト最適化)

`src/lib/claude/client.ts` の `CLAUDE_MODELS` で定義。呼び出しは `src/lib/claude/predict.ts`。

- `screening` = Haiku 4.5 (`claude-haiku-4-5`): 全レースの一次スクリーニング
- `standard` = Sonnet 5 (`claude-sonnet-5`): 標準レースの診断表生成
- `premium` = Opus 4.8 (`claude-opus-4-8`): 「本気で買う」と判定した重要レースのみ

月額運用コスト目安: JRA-VAN会費込みで約4,000〜5,000円/月。

## 予想ロジック (3本柱+おまけ)

1. 絶対能力 (馬自体の実力)
2. ペース・位置取りの不利 (直近3走以上を追跡)
3. トラックバイアス (内前有利/外差し等)
4.5. (補助的加点材料) 装備変更 (ブリンカー等)・騎手による過剰人気への懐疑。あくまでおまけ的な参考要素
6. コース×距離ごとの枠順データ評価 (例: 阪神芝1200mは外枠有利など、コース特性ごとの枠順傾向をAPI取得データから分析し評価に反映)

## 馬券方針

- ワイド・馬連のみ。3連複は買わない
- 買い目は「本命→相手1頭」の1点に絞る
- 回収率重視

## レース投資判断

- 診断表作成前に、レース自体をS/A/B/Cで評価 (S=価値・的中率とも高い、C=見送り推奨)
- 個別馬のランクとは別軸

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

- netkeibaのshutuba.html (一次情報)
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

現状の`training_sessions`テーブル(course_type/time_sec/time_interval等の汎用フリーテキスト設計)は、HC/WCの実際のフィールド構造(800M/2000Mを200M刻みで区切った複数ラップタイムを1レコードに持つ)とズレがある。次にDBスキーマを見直す際はHC/WC別テーブル、または区間ごとのラップタイムを配列/JSONBで持つ構造に再設計するのが望ましい (今回は調査のみ、スキーマ変更は未実施)

netkeibaは追い切りデータの取得元として使わない (JV-Data優先原則の通り、HC/WCで代替できるため)。

**調教評価の設計方針 (2026-07-10、ユーザーからの指摘)**: 調教タイムは単純な絶対値では良し悪しを判断できない (馬場状態・併せ馬・気配等に左右されるため)。むしろ以下の相対比較が重要な判断材料になる。
- その調教師の「本気パターン」との比較 (普段より時計が良い/併せ馬が強い等、厩舎ごとの「仕上げてきた」サインの学習)
- その馬自身の過去の調教タイムとの比較 (絶対値ではなく自己ベース比での良し悪し)

これは既存の「予想軸の拡張方針」節の「厩舎ごとの追い切りパターン学習」と同じ発想。training_sessionsの再設計時は、厩舎×調教師単位・馬個体単位でそれぞれベースラインを集計できる構造にする必要がある (絶対タイムだけを閾値判定に使う設計にはしない)。

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

**推奨方針**: 種牡馬別成績・配合パターンの回収率ベース分析(穴馬推奨に使いたい機能)は、外部サイトのスクレイピングに頼らず、**自前で計算する**方針を軸にする。BLODで血統樹を持ち、past_performances(odds_win等を含む、蓄積が進めば自レースのオッズ実績も)と組み合わせて、種牡馬×距離帯/馬場/コースごとの成績・回収率を自分たちで集計する (sire_stats/nick_statsテーブルは既に用意済み)。ただしこれは相応の蓄積期間 (数年分のレースデータ) が必要で、トラックバイアスの「毎年同じ開催」参照と同様、運用開始直後はデータが薄い制約がある。外部データで即座に厚みを持たせたい場合は、JBISへの正式な利用許諾の問い合わせを別途検討する

⚠️ netkeibaのアンチスクレイピング対策の詳細と対応方針は上記「netkeibaアンチスクレイピング対策の詳細と対応方針」を参照。

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
  - この実測値からの概算: 全35レース/日をscreeningし、Cで弾かれなかった~15レースをstandardまで進めると、screening ¥35/日 + standard ¥172/日 ≈ **月換算で約6,000円程度**(premium抜き)。当初の月4,500~12,000円という概算より、少なくともscreening+standard部分は下振れしそうな実測結果

### 次回やること

1. **premium(Opus)の実測usage取得の判断** — Opusは他より高コストなため、実測を取るかどうかユーザーに確認してから実行する
2. **予想軸・階層のコスト最適化方針の決定** — 「たくさん予想して精度を見たいが実際に買うのは~5レース」という運用実態を踏まえ、(a) 未勝利・新馬戦はOpusへエスカレーションさせずSonnet止まりにする、(b) screeningでCと判定されたレースもstandardまでは回して精度検証データを蓄積する、等の方針を検討中。実測値が出揃ってから最終判断する
3. **実ブラウザでの見た目確認** — `/races`・`/races/[raceId]`をスマホ幅で実際にレンダリングし、カラーコード・ボタンの見え方・横スクロール表組みを確認する
4. **training_sessions / horses・血統関連テーブルの再設計** — 確定したHC(坂路)/WC(ウッドチップ)のレコード構造(200M刻みの区間タイム・ラップタイムを1レコードに複数持つ)、BLOD(3代血統・14頭分の繁殖登録番号)の構造に合わせて、現状の汎用設計を見直す。調教は「絶対タイムではなく厩舎の本気パターン・馬自身の過去との相対比較」で評価する設計にする (2026-07-10のユーザー指摘を反映)
5. **sire_stats/nick_statsの自前集計方針の具体化** — JBISサーチ等の外部スクレイピングに頼らず、BLODの血統樹+自蓄積のpast_performances(オッズ含む)から種牡馬×距離帯/馬場/コースの成績・回収率を自前で集計する設計を詰める。運用初期はデータが薄い制約があるため、当面は「穴馬推奨」機能の精度は限定的になる前提で進める
