<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 競馬予想Webアプリ

## ⏸️ 引き継ぎ中の相談 (2026-07-10更新、ここから再開)

1. **新馬戦・障害レースは診断対象外に決定・実装済み (2026-07-10)** — `route.ts`の`POST`冒頭で`race.track_type === "障害"`または`race.race_class`に"新馬"を含む場合、screening(Haiku)すら呼ばずに`{ tier: "skipped" }`を返すよう変更済み。ユーザーの月¥4,000程度に抑えたいという要望を受けての対応。**未検証:** 実際のnode/npm環境がこのセッションのサンドボックスになく`tsc`/`next build`を回せていない。次回、`npm run build`または`tsc --noEmit`で型エラーがないか確認すること
2. **screeningでC評価が出たレースはstandardへ進めず打ち切りで確定 (2026-07-10)** — 「精度検証データを蓄積するため全レースをstandardまで回す」案は不採用。コード(`route.ts`)は元々C評価で打ち切る実装のままで、これは変更不要。**注意:** この決定はコストを追加削減するものではない(¥6,000/月・新馬障害除外後¥4,500~5,200/月の見積もりは元々この打ち切り込みの数字。「全部standardまで回す」という逆方向の変更を採用しなかっただけ)。¥4,000/月ちょうどを狙うには別のレバー(premium手動化・screening基準の厳格化等)が必要
3. **premium(Opus)診断の実測usageを取るか?** — まだユーザーの明示的な回答待ち。Opusは高コストなので実測を取る前に確認する約束をしていた(screening/standardは実測済み、下記参照)
4. **premium(Opus)の自動エスカレーションを廃止し、手動「本気診断」ボタンに変更・実装済み (2026-07-10)** — `route.ts`の`POST`はstandardでS評価が出ても自動ではpremiumへ進まなくなった(`return NextResponse.json({ tier: "standard", result })`で終わる)。代わりに`POST /api/races/[raceId]/diagnose?tier=premium`を新設し、`race.race_rank === "S"`のレースのみ手動でOpus診断を実行できるようにした(S以外は400エラー)。`DiagnoseButton.tsx`に`raceRank`propを追加し、S評価のレースだけ「本気診断する」ボタン(amber色)を表示するよう変更、`page.tsx`から`raceRank={race.race_rank}`を渡すよう更新。これにより「実際に買うか検討する~5レース/日」だけにOpusコストを絞れる設計になった。**未検証:** node/npm環境がこのセッションのサンドボックスになく、`tsc --noEmit`・`next build`・実ブラウザでのボタン動作確認ができていない。次回、環境がある場所でビルドと動作確認を行うこと
   - 背景: ユーザーは当初月¥12,000のコストは払いたくない、実際に買うのは~5レース/日程度、という制約から相談を開始。今回さらに月¥4,000程度への圧縮を希望

**✅ gitコミット済み (2026-07-10)。** それまでのセッションで実装していた内容(DBスキーマ、予想エンジン、netkeibaスクレイパー、フロントエンド、使用量ログ機構など)は`1b8e311`でコミット済み(ローカルのみ、push未実施)。

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

- **`race_payouts`(新設)** — レース確定後の実際の払戻金 (単勝/複勝/枠連/馬連/ワイド/馬単/三連複/三連単、馬番の組み合わせ、100円あたりの払戻金)。**要確認:** JV-Dataの配当情報レコード(仕様書上の正式なレコードID・フィールド構成)はまだ調査していない。SLOP/WOOD/BLODと同様に次回JV-Data仕様書で確認すること。今は一般的な中央競馬の払戻区分から設計した仮の構造
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
8. **JV-Dataの配当情報レコード種別を調査する** — `race_payouts`の構造は仮設計のため、JV-Data仕様書(SLOP/WOOD/BLODを調べた時と同じ資料)で正式な配当レコードのID・フィールド構成を確認し、必要ならスキーマを調整する
9. **race_recommendation_results算出バッチの実装** — レース確定後に`race_payouts`と`races`の推奨内容を突き合わせて的中・回収率を計算する処理。JV-Link接続・実データ投入が前提
