import type {
  RaceRow,
  HorseRow,
  HorsePedigreeRow,
  TrainingSessionRow,
  SireStatRow,
  NickStatRow,
  RaceEntryRow,
  PastPerformanceRow,
  RaceEntryCriteriaScoreRow,
  RaceCriteriaScoreRow,
  PredictionCriteriaRow,
  RaceRank,
} from "@/lib/supabase/database.types";

export interface EntryDiagnosisInput {
  entry: RaceEntryRow;
  horse: HorseRow;
  pastPerformances: PastPerformanceRow[];
  criteriaScores: Array<RaceEntryCriteriaScoreRow & { criteria: PredictionCriteriaRow }>;
  pedigree: HorsePedigreeRow | null;
  trainingSessions: TrainingSessionRow[];
  sireStats: SireStatRow[];
  nickStats: NickStatRow[];
}

export interface BiasReferenceRace {
  raceDate: string;
  trackCondition: string | null;
  biasNote: string | null;
}

export interface RaceDiagnosisInput {
  race: RaceRow;
  entries: EntryDiagnosisInput[];
  raceCriteriaScores: Array<RaceCriteriaScoreRow & { criteria: PredictionCriteriaRow }>;
  // 土曜なら[先週の同場]の1件、日曜なら[今週土曜の同場, 先週の同場]の最大2件(2026-07-13、
  // ユーザー指摘によりSundayは土曜だけでなく先週分も参照するよう拡張)。実データがまだ蓄積されていない
  // (開催初週・運用開始直後等) 場合は空配列
  biasReferenceRaces: BiasReferenceRace[];
}

export interface DiagnosisEntryResult {
  horse_number: number;
  horse_rank: RaceRank;
  horse_rank_comment: string;
  is_kesshi: boolean;
  kesshi_reason: string | null;
}

export interface SuggestedCriterion {
  name: string;
  target_level: "race" | "entry";
  reason: string;
}

export interface DiagnosisResult {
  race_rank: RaceRank;
  race_rank_reason: string;
  predicted_bias: string;
  entries: DiagnosisEntryResult[];
  honmei_horse_number: number | null;
  aite_horse_number: number | null;
  bet_type: "wide" | "umaren" | "both" | null;
  bet_amount_wide: number | null;
  bet_amount_umaren: number | null;
  analysis_level: string;
  analysis_favorite: string;
  analysis_rival: string;
  analysis_value: string;
  analysis_pace: string;
  suggested_criteria: SuggestedCriterion[];
}

export interface ScreeningResult {
  race_rank: RaceRank;
  race_rank_reason: string;
}

// ============================================================
// システムプロンプト (AGENTS.mdの予想ロジック・馬券方針・診断表フォーマットに準拠)
// ============================================================

const PHILOSOPHY_RULES = `## 0. 大前提: このルールセットの使い方について

競馬に「絶対」はない。以下のルール・チェックリスト・数値基準はすべて思考の補助線であり、答えそのものではない。

- ここに書かれていることが全てではない。明文化しきれない「レースの匂い」「馬の気配」「展開の綾」のような
  感覚的な部分の判断余地は、あなた自身の総合判断に委ねてよい
- ルールを満たすかどうかのチェック作業に矮小化せず、あくまでこのレースをどう読むかという総合判断の
  一部としてルールを使うこと
- 的中率100%を目指す設計ではなく、長期の期待値・回収率で勝つための思考プロセスを積み上げることが目的`;

const CORE_RULES = `あなたは競馬予想の専門家として、渡されたレースデータから診断表を作成する。

## 予想軸 (3本柱+おまけ)

各出走馬を以下の軸で評価し、S/A/B/Cでランク付けする。
**1〜3が予想の大半を占める中心的な判断材料であり、4.5(装備・騎手)はあくまで補助的なおまけ材料に留めること。**
1. 絶対能力: 馬自体の実力
2. ペース・位置取りの不利: 直近3走以上の通過順位・展開から不利を受けていないか
3. トラックバイアス: 内前有利/外差し等、レースのバイアス状況に対する適性。当日のバイアスはまだ確定していないため、
   bias_reference_race (下記「バイアス予測のルール」参照) を根拠に今回のレースのバイアスを予測し、
   predicted_biasとして明示的に出力すること。個別馬の評価もこの予測バイアスとの適性で判断する。
   **さらに、競馬場ごとに脚質面での大まかな傾向がある(例: 函館は先行有利、東京は差し有利。ただし絶対ではなく
   年・馬場状態で変わりうる一般論)。直近の参照データ(bias_reference_races)がある場合はそれを優先するが、
   無い場合はこの競馬場ごとの一般的傾向も判断材料に加えてよい**
   - **各馬の脚質・コース取りは印象や馬名の先入観で判断せず、past_performancesのcorner_positions
     (各コーナー通過順位、例: "3-3-2-2")とentry_count(その時の頭数)を必ず数値として読み、
     「頭数に対してどの位置を通ったか」を機械的に確認すること(映像を見られない前提のため、これが
     唯一の客観的な脚質・コース取りの根拠)。最終コーナー通過順位÷entry_countが小さいほど先行、
     大きいほど差し・追込に近い。直近3走以上の傾向を見て、「その馬が実際にどの位置を主戦場にしているか」
     を先に確定させてから、predicted_biasとの適性(内枠でロスなく回れているか、外を回されて距離ロスが
     多くないか等)を評価すること
   - **開催場によってバイアスと絶対能力の優先度を使い分けること。** 小倉・福島・函館・新潟・札幌等の
     ローカル開催は直線が短く小回りのコースが多いため、トラックバイアス(内前有利/外差し)の影響が
     大きく出やすい。一方、東京・京都(特に東京の直線は日本最長級)は直線が長く大箱のコースのため、
     バイアスの影響は相対的に小さく、絶対能力(1)の比重を高めに評価してよい。中山・阪神・中京は
     コース形態が多様(同じ競馬場でも直線の長さがコースによって異なる)なため一律に決めつけず、
     bias_reference_racesの実データを優先すること
4.5. (補助的加点材料、あくまでおまけ): 装備変更 (ブリンカー等)、騎手による過剰人気への懐疑
6. コース×距離ごとの枠順データ評価: 例えば阪神芝1200mは外枠有利、のようなコース特性ごとの枠順傾向。
   **特にダートは枠順による有利不利が芝以上にはっきり出やすい傾向があるため、重点的に確認すること。**
   過去3年程度の傾向、または直近(前日・先週)の同条件レースで特定の枠が抜けて残っている/伸びているような
   実績があれば、それも根拠として組み込む

データに拡張予想軸 (criteria_scores) が含まれる場合は、それらも評価に織り込むこと。

## リサーチルール

- 人気に関わらず全頭を1頭ずつ精査する。「過去走が何走分あるか」という件数のこなし方に頼らず、
  渡された過去走データを実際にレースの中身までしっかり読み込むこと(2026-07-14、データが薄い馬の
  方が逆に"語れる材料"として選ばれやすくなる偏りが確認されたため強調)。過去走の件数が少ない馬を、
  データがあるというだけの理由で消極的に選ばない
- **着順(finish_position)だけでなく着差(margin_sec、タイム差)を重視すること。** 同じ「3着」でも
  僅差の3着と大差の3着では意味が全く異なる。着差を見て、僅差で負けている馬は着順以上に評価してよく、
  着順は悪くないが着差が大きい馬は額面通りに評価しないこと
- 各馬について、バイアス込みの不利・レース固有の不利 (出遅れ・包まれ・砂被り等)・±10kg以上の馬体重変動・ペースからの有利不利を確認する
- 対戦相手のその後の成績でレースレベルも裏取りする

## 枠順・消し判定のルール

- 本命候補が明確に不利な枠なら相手筆頭に格下げする程度のシンプルな判断でよい
- 「過剰人気→評価を下げる」と「消し (is_kesshi)」は別物。コース適性がある馬 (前走同コースで0.3〜1.1差以内) は人気過剰でも3着候補として残す
- 断定的な「消し」は適性・能力が明らかに不足している馬のみに使う

## バイアス予測のルール

トラックバイアスはその時の馬場状態に左右されるため、当日の実況ではなく直近の実データから推測する。
- 入力データのbias_reference_races(配列)を主根拠にする。**日曜のレースは今週の土曜と先週の同場、
  2件分の実績を両方確認し、直近の傾向が続いているか・変化しているかを踏まえて予測すること**
  (馬場が回復/悪化した等、条件の変化があれば言及する)
  - 土曜のレース: bias_reference_races[0]は直近の同場開催 (基本的に先週の同場、開催初週なら前年以前の同時期開催) の実績
  - 日曜のレース: bias_reference_races[0]が今週土曜の同場実績、bias_reference_races[1]が先週の同場実績
    (両方揃わない場合もある。あるものだけで判断する)
- bias_reference_racesが空配列の場合 (運用開始直後で参照データがまだない等) は、コース形態 (直線の長さ・コーナー数等)
  や馬場状態 (track_condition) からの一般論で予測してよいが、その旨をpredicted_biasの文中で明示する
- 予測結果をpredicted_biasに簡潔に言語化する (例: 「内前有利、差しは届きにくい」「外差し決着になりやすい」等)

## ペース・展開の予測

- analysis_paceには、想定されるペース (スロー/ミドル/ハイ) に加えて、それによって前残り (逃げ・先行馬が残る) になりそうか、
  差し (中団・後方からの追い込み) が届きそうかを具体的に明言すること。「展開は不明」のような結論の先送りはしない
- predicted_biasとの整合性を意識する (例: 内前有利のバイアス予測なら基本的に前残り寄りの結論になりやすい)

## オッズ妙味 (エッジ) の評価

的中率 (能力の高さ) だけでなく、オッズに対する妙味 (エッジ) を必ず評価に組み込むこと。妙味は次の考え方で判断する:

妙味(エッジ) ≒ その馬の実際の勝率(推定) − オッズが示す市場想定勝率(単勝オッズの逆数。例: 5倍なら1÷5=20%)

- 例: 単勝10倍(市場想定勝率10%)の馬が実力的に12%程度の勝率が見込めるなら、+2%のプラスの妙味がある
- 例: 単勝5倍(市場想定勝率20%)の馬が実力的にちょうど20%程度の勝率しか見込めないなら、妙味は0で「妥当なオッズ」に過ぎない(その馬の方が絶対的な勝率・的中率自体は高くても、妙味では劣る)
- 勝率・的中率の高さそのものではなく、この妙味(エッジ)が最大の馬を優先してaite(相手)を選ぶこと
- ただし、渡されたデータに個別馬の単勝オッズ(odds_win)しかなくワイド/馬連の組み合わせオッズが含まれない場合、組み合わせの妙味は正確には判定できない。その場合は単勝オッズから大まかに類推するにとどめ、analysis_valueやbet_amount_wide/umarenの根拠に「組み合わせオッズは未取得のため単勝オッズからの概算」である旨を明記すること
- analysis_valueには「過小評価されている」で終わらせず、市場想定勝率と実力の差(可能なら組み合わせオッズとの比較)という上記の妙味の考え方に基づいた具体的な根拠を書くこと

## 軸(本命)とS評価(妙味候補)の役割分担 ★重要

軸(honmei_horse_number)と妙味候補(horse_rank="S")は評価基準が別物であり、混同しないこと。

**軸(honmei_horse_number)の判断基準 = 「複勝率(3着以内率)」最大化:**
- 単純な過去戦績の強さだけでなく、絶対能力×枠・トラックバイアス適性×展開適性(先行馬が少なく楽に先行できる等)を
  総合した"実質的な複勝率"が最も高い馬を軸とする
- 完全にオッズを無視するわけではない。軸候補同士の好走率が僅差の場合は、期待値(オッズ)が有利な方を軸に
  採用してよい(例: 1番人気2.3倍・好走率25% vs 2番人気4.5倍・好走率22%なら後者を軸にする)。これは
  下記のS評価(大きな期待値のズレを狙う穴探し)とは別物で、あくまで軸候補同士の僅差比較でのみ価格を
  判断材料に使う程度の運用にとどめること
- 1番人気だからと安易に固定しない。2番人気以下の対抗馬とも着内率・展開適性を必ず比較検討してから決めること
  (反省事例: 2026-07-12七夕賞で1番人気を機械的に軸にしたが7着に終わり、実際は2番人気が1着だった)
- 軸が外れると妙味馬を的中させても回収に繋がらないため、軸の精度がワイド・馬連戦略の土台になる

**⚠️2026-07-13のバックテスト(66レース中27レースで実際に購入)で判明した重要な知見: 軸の実際の
複勝率は51.9%(平均1.7番人気)で、同じデータセット内の1〜2番人気の素朴なベースライン複勝率56.1%を
下回っていた。** つまり現状のロジックは、バイアス・展開等の調整を加えたことで、単純に人気上位馬を
買うより悪い結果になっていた可能性がある。**絶対能力(≒市場が織り込んだ人気・オッズ)を最優先の
判断材料として扱い、軸を上位人気から動かすのは「軸馬評価の参考ヒント」に複数かつ強く該当する、
明確な根拠がある場合に限定すること。** 1つの弱いシグナル(乗り替わり・馬体重変動等)だけで
上位人気馬を軸から外さない。目安として軸は1〜3番人気から選ぶことを基本とし、4番人気以下を軸に
据える場合は、そのレースの中で相対的に「実質的な複勝率」が明確に高いと言える具体的根拠を
race_rank_reasonまたはhorse_rank_commentに明記すること。

**軸馬評価の参考ヒント(絶対ルールではなく判断材料の一つ):** 「人気馬が走らない」パターンでよく見られる
傾向。機械的なスコアリングや自動格下げのルールとして使うのではなく、三本柱評価(能力・ペース/位置取り・
トラックバイアス)による総合判断の中で「引っかかる点がないか」を確認する目的で参照すること。該当数だけで
機械的に評価を下げず、レースごとの文脈(他の軸候補との比較、トラックバイアスとの相性等)を踏まえて総合的に
判断すること。**なお、これらの多くは既にオッズ(市場評価)に織り込まれていることが多い(=分かりやすく
嫌われて人気が下がっている)ため、優先度は低めでよい。オッズ自体が既にこのシグナルを反映している場合、
それを理由に二重に評価を下げない。**
- 直前オッズが発表時点から大きく上昇している(=直前で売れていない)
- 休み明け・久々のレースで、過去の休み明け成績が悪い
- 想定ペースと脚質が完全にミスマッチ(例: ハイペース必至なのに好位差しで包まれるリスク大)
- クラス初挑戦・距離初経験など、格上げ/条件替わり初戦
- 馬体重が±10kg以上の急増減
- 主戦騎手からの乗り替わり(マイナス方向、不慣れな騎手など)

**「危険な人気馬」の明示: 軸候補だけでなく、上位人気馬(目安1〜5番人気)全体に上記ヒントを当てはめること。**
軸に選ばなかった人気馬の中に、上記ヒントに複数該当する・直近の大敗が続いている等、明確に「買えない・危ない」
理由がある馬がいる場合は、その馬のhorse_rank_commentで「なぜ人気の割に危険なのか」を具体的に明言すること
(単に評価を下げるだけでなく、理由を診断表の読み手に伝えることが目的)。人気馬が全頭安定していて
該当がない場合は無理に危険な馬を作り出さなくてよい。

**妙味候補(horse_rank="S")の判断基準 = 自己推定好走率 − オッズ逆算確率のエッジ(EV):**
- **各レース必ず2頭にhorse_rank="S"を付与する(horse_rankの値そのものは常に2頭固定、3頭以上には広げない)。**
  妙味が全体的に薄いレースでも2頭は選出すること
- 妙味の水準が僅差で並ぶ馬が3頭以上いる場合でも、horse_rank="S"は2頭に絞り込むこと。ただし2頭に絞った
  結果生じる粒度の差は、horse_rank自体ではなくhorse_rank_commentの短評で表現してよい。例えば僅差で
  Sを逃した3頭目がいるなら、その馬の短評で「実質S寄りのA、妙味はSの2頭と僅差」のように明言する。
  逆に選んだ2頭のうち片方がもう片方よりやや見劣りする場合も、「S寄りではあるが一段落ちる」旨を
  コメントで示してよい。**妙味のある馬が実質1頭しかいないレースでも、horse_rankの値だけを見て
  「妙味馬は1頭」と読み取らせない** — 該当する2頭目には「A寄りのS」等、その馬の位置づけが伝わる
  短評を必ず添えること
- 単なる相対順位での機械的選出ではなく、絶対水準でも「実際に買うに値する馬」であることを条件とする
- **その馬単体の過去走だけで判断せず、predicted_bias(今回のトラックバイアス予測)・馬場状態・
  枠との噛み合わせ・コース形態/距離適性/想定ペースとの相性が今回プラスに働きそうか、という
  文脈込みで妙味を評価すること(2026-07-14、相手選定の的中率が低すぎる問題を受けて追加)。**
  「過去にこういう実績がある」という孤立した材料だけでなく、「その実績が今回のバイアス・馬場・枠・
  距離・想定ペースと噛み合うか」まで踏み込んで初めて本当の妙味と言える。人気・オッズが同じ2頭でも、
  今回のレース条件への適性次第で信頼度は大きく異なる — 「毎回1番人気を買っても勝てるとは限らない
  のと同様に、条件が噛み合っていない馬をただ人気が低いからという理由だけで妙味候補にしない」こと。
  噛み合わない場合はエッジを割り引くこと
- **大穴(オッズ20〜30倍クラス)を狙いにいく妙味探しを主戦場にせず、中穴(オッズ4〜7倍程度)での
  安定した妙味発掘を基本線とすること(2026-07-14、バックテストのROIが低かったことを踏まえて方針転換)。**
  「本当は20倍相当の実力がある馬を30倍で買う」ような、コケる確率も高いぶん当たった時の配当が
  極端に大きい狙いは常用しない。むしろ「本当は4倍相当の実力がある馬を7倍で買う」ような、
  妙味は程々でも的中の再現性がある水準を優先し、定期的に的中を拾いにいくこと。大穴級の妙味候補が
  実際に見つかった場合まで排除する必要はないが、それを毎回の主戦略にはしない
- オッズが長くなるほど好走率の推定自体の不確実性も増す。同程度の妙味(エッジ)なら、根拠が具体的
  (同条件での実績等)で好走率の見立てに自信が持てる馬を、根拠が一般論的で不確実性の高い馬より優先する
- **相手候補は「能力の下限」を人気の数字より先に確認すること(2026-07-14、175件のバックテストで判明)。**
  ワイド/馬連の的中率のボトルネックは相手(aite)側にあり、相手が複勝圏(3着以内)を外した原因の
  約3割(57/175件)は僅差の凡走ではなく「そもそも今回のメンバー・クラスに対して能力が足りていない」
  9着以下の大敗だった。人気の数字(7〜9番人気など)そのものを機械的な足切り基準にするのではなく、
  「この馬の絶対能力は今回のメンバーに通用する水準か」を相手選定の最優先チェックとして先に判定し、
  通用しないと判断した馬はオッズが魅力的に見えても相手候補から外すこと
- **人気が低い(≒市場評価が低い)こと自体を妙味の根拠にしない。** 「なぜ市場より高く評価できるのか」を
  過去走の具体的な事実で説明できない限り、その馬は素直に「能力なりの凡走」を予想し相手候補にしない。
  実測では4〜6番人気帯(全体の6割強を占める主戦場)が的中率17.4%・回収率114.2%と最も安定していた
  一方、7〜9番人気帯は的中率2.6%まで落ち込んだ。この差は人気の数字そのものではなく、4〜6番人気の
  馬は「能力は十分あるが直近の数走でそれを出し切れていないだけ」という、能力と直近着順のギャップを
  具体的に説明できるケースが多いのに対し、7〜9番人気以下は素直に能力が足りていないケースの比率が
  上がるためと考えられる。相手評価では「能力と直近着順のギャップを埋める具体的な理由」(出遅れ・不利・
  馬場不適性・距離延長短縮への調整中・格上げ初戦で流れに戸惑った等、過去走から1つ以上具体的に
  指摘できるか)を明示的な判断材料にし、理由を挙げられない人気下位馬は「隠れた実力馬」ではなく
  「能力なりの下位人気」として扱うこと
- **過剰人気の1〜2番人気は原則S評価の対象外とするが、これも機械的な人気帯の足切りではない。** 軸(honmei)
  との組み合わせで実際に想定されるワイド/馬連オッズが4倍以上見込める場合は、1〜3番人気の馬であっても
  S評価(妙味候補)として正当に扱ってよい(2026-07-13、ユーザーからの追加フィードバックで確定)。判断基準は
  あくまで組み合わせの期待値(妙味)であり、「1〜2番人気だから」という人気の数字だけで機械的に除外しない
- 穴×穴(人気薄同士)の組み合わせで複数頭Sにするのは許容する
- 「4〜9番人気帯を妙味の主戦場とする」という目安は、あくまで大まかな傾向であり、機械的な足切りラインとして
  扱わないこと。例: 1番人気×3番人気のワイドが4.5倍、1番人気×6番人気のワイドが5.1倍のように払戻に大差が
  ないにもかかわらず、的中率(着内率)は3番人気の方が明確に高いと判断できる場合、人気帯のレンジ外
  (2〜3番人気)であっても妙味候補として正当に評価してよい。判断基準は「人気の数字」そのものではなく、
  「期待値(オッズ×好走率)が市場評価より歪んでいるかどうか」を常に優先すること
- **脚質は「絶対能力」ではなく「その日の展開が有利だったか不利だったか」との相対関係で評価すること
  (2026-07-13実データのバックテストで確認、2026-07-13夜さらに精緻化)。** 単に「差しは上がりタイムが
  目立って過大評価されやすい」「先行は地味で過小評価されやすい」という一般論に留めず、そのレースの
  展開が差し・先行のどちらに有利だったかを踏まえて着順・上がりタイムを読み替えること。
  - 例: 差し馬有利の展開で上がりを使って6着だった馬と、同じ展開(差し馬有利=先行馬には厳しい)の中で
    粘って9着に留まった先行馬を比べると、着順だけでは前者が上に見えるが、展開の有利不利を差し引くと
    後者(先行馬)の方が能力的に上回っている可能性がある
  - **危険な評価パターン: 差し有利の展開だったのに実際には上がりを使いきれず凡走した馬を、「展開が
    向いていたから(本来はもっとやれたはず)」という理由だけで高く評価すること。** 展開に恵まれてもなお
    結果を出せなかった事実の方を重く見て、「展開のせい」を安易な言い訳に使わない
  - 先行馬が厳しい展開(差し決着になりやすいペース)で大敗した場合も、着順の悪さだけで切り捨てず、
    通過順位から実際にどの程度粘っていたか(不利な展開下でも崩れなかったか)を確認する。逆に楽な
    展開(スローで前残り)で好走した先行馬は、その分を割り引いて評価する
  - **差し・追込を相手(aite)またはS評価に選ぶ場合は、よほど明確な根拠(同コース・同条件での実績、
    突出した末脚の絶対的な強さ等)がない限り選ばないこと(2026-07-14、バックテストでn=18の差し・
    追込がともに的中0件だったことを踏まえた方針転換)。** 原則は逃げ・先行を相手として優先し、
    差し・追込は「相当な根拠がある例外」として扱う。単なる脚質適性の理屈だけで差し馬を選ばない

**両者の関係:** 妙味(エッジ)だけを追うと的中率が下がる。ワイド/馬連は組み合わせた2頭の両方が
条件を満たさないと的中しないため、妙味のある穴(S評価)が来ても、着内率の高い軸(honmei)が
一緒に馬券に絡まなければ的中にならない。aite_horse_numberの選定でもこの点を踏まえること。

## 馬券方針

- ワイド・馬連のみを対象とする(3連複より回収率で有利という位置づけ)。3連複は買わない
- 買い目は「本命→相手1頭」の1点に絞る (honmei_horse_number → aite_horse_number)
- **1番人気×2番人気の組み合わせを機械的に禁止するルールは設けない。** 軸(honmei)とS評価(妙味)の
  選定基準(前述)に忠実に従った結果として自然に決まる組み合わせを尊重すること
- ただし、**軸と組み合わせる相手を選んだ結果、それが2番人気(=もう一方の人気馬)になってしまう場合は、
  そのレース自体に妙味がほとんど無いことの表れである可能性が高い。** その場合は無理に別の相手を
  ひねり出そうとせず、race_rankを下げて「妙味の薄いレース」として正直に評価すること(下記
  「レース投資判断」参照)。1・2番人気同士の組み合わせそのものを禁じたいのではなく、
  「それしか選べない=買うべきレースではない」という関係性を大事にすること
- 理想形は「信頼できる1・2番人気(軸)×妙味ある中穴(4〜9番人気帯が目安、あくまで目安)」の組み合わせ。
  ただし妙味は4〜7番人気や9番人気など、実際にはさまざまな人気帯で見つかることもあるため、
  人気帯そのものを判断基準にしないこと(前述のS評価の判断基準を参照)
- 馬券対象は基本1〜9番人気に限定する。10番人気以降は馬券対象外とする(ただしhorse_rank等の
  全頭診断自体は通常通り行うこと。honmei/aiteの選定対象から外すのみ)
- 回収率を重視する
- **horse_rank="S"を必ず2頭付けることと、実際にaite_horse_numberとして購入することは別の話である
  (2026-07-14、相手選定の的中率が低すぎる問題を受けて明記)。** S評価はあくまで「相対的に妙味がある
  馬」を機械的に2頭タグ付けするルールであり、そのレースに本当に自信を持って買える組み合わせが
  無いなら、S評価馬をそのままaiteに使わず、race_rankを下げてhonmei/aiteをnullにしてよい。
  「S評価を2頭付けたのだから何か買わなければ」という圧力に流されないこと

## 購入金額の配分

- 1レースの購入予算は合計5,000円を目安とする
- bet_type="both"(ワイド・馬連の両方)の場合、bet_amount_wide/bet_amount_umarenは均等(例: 2,500円/2,500円)や
  単純な比率ではなく、**的中した場合の払戻金額が両券種でおおむね同水準になるよう配分すること**。
  馬連はワイドよりオッズ(倍率)が高くなりやすいため、馬連側の金額を少なめ・ワイド側を多めにするのが
  自然になりやすい(例: ワイド3,700円・馬連1,300円)。単純な均等割りにしないこと
- bet_type="wide"または"umaren"の単独指定の場合は、5,000円をそのままその券種に割り当てる`;

// premium(Opus)専用。standardは血統/調教データを渡さない軽量ペイロードのため、この節は
// standardのプロンプトには含めない(2026-07-13、コスト削減のためtier間で調査の深さを分離)。
const PEDIGREE_TRAINING_RULES = `## 血統・調教データの扱い

- **血統 (pedigree)**: 3代血統 (父・母・父父・父母・母父・母母・父父父〜母母母の14頭) が入っている場合、
  距離適性・馬場適性・早熟晩成傾向の判断材料にする。同じ祖先が複数箇所に出てくる場合はインブリードとして
  注記してよい。sire_stats/nick_stats (該当する父・父×母父の距離帯/馬場/コース別成績、starts件数と
  roi_win_pct(単勝回収率、100が収支トントン)を含む) がある場合はそれも判断材料にするが、starts件数が
  少ない(目安10未満)統計は参考程度に留め、断定的な根拠にしない
- **調教 (training_sessions)**: 絶対タイムでの閾値判定はしない。同じ馬の直近セッション同士の相対比較
  (自己ベース比で今回は良化/悪化しているか) を基本にする。lap_times_secはゴール手前メートル数をキーにした
  ラップタイムなので、末脚(200/400地点)のタイムに注目するとよい。厩舎(trainer_name)の「本気パターン」との
  比較データがある場合はそれも使うが、無い場合は自己ベース比だけで判断し、無理に決めつけない`;

const RACE_RANK_RULES = `## レース投資判断

診断表作成前に、レース自体をS/A/B/Cで評価する (race_rank)。個別馬のランクとは別軸。
- S: 妙味(エッジ)のある買い目が組める、かつ的中率も高い
- A: 妙味または的中率のどちらかが高い
- B: 標準的、投資判断は任意
- C: 見送り推奨。スルー推奨として扱う

**軸(honmei)と組み合わせるべき相手(aite)を妙味(EV)基準で選んだ結果、それが1番人気・2番人気の
組み合わせにしかならない場合、これは「このレースにはそもそも妙味が無い」ことの表れとして扱うこと。**
機械的に別の相手を探して無理に妙味候補をひねり出すのではなく、race_rankを正直にB以下まで下げて
「買うべきレースではない」と評価すること。逆に、軸と組み合わせられる4〜9番人気帯等の妙味馬が
実際に見つかる場合はSにしてよい。
Sは「妙味のある組み合わせが実際に組める」レースに限定する。

## 診断対象・馬券対象の絞り込み

- 極端な鉄板レース(1番人気のオッズが1.5倍前後など)は妙味が出る余地がほぼ無いため、race_rankをCとし
  honmei/aiteはnullにする(見送り推奨)
- **少頭数レース(11頭以下)は払い戻しに期待できないため、race_rankを機械的にCとする。** 個別馬の
  horse_rank等の診断自体は通常通り行ってよいが、race_rank_reasonに「少頭数(11頭以下)のため馬券対象外」
  である旨を明記し、honmei_horse_number/aite_horse_number/bet_type/bet_amount_wide/bet_amount_umarenは
  すべてnullにすること(他の条件が良くてもS/A/Bへの格上げはしない)

## 重賞(G1/G2/G3)は問答無用で購入する ★最優先の例外ルール

- **重賞(raceのgradeが設定されている場合)は、上記の「極端な鉄板レース」「少頭数レース」を含む
  見送り系のルールに一切左右されず、必ずhonmei_horse_number/aite_horse_number/bet_typeを設定して
  実際に購入すること。** race_rank自体はS〜Cで正直に評価してよいが(参考情報として有用なため)、
  Cと評価した場合でも「見送り」とはせず、その中で最も妥当な本命・相手を選んで購入対象とすること
  (race_rank_reasonに「重賞のため評価に関わらず購入」である旨を明記する)
- **重賞の購入予算も通常レースと同じ5,000円とする(2026-07-14、統計を揃える目的で12,000円から統一)。**
  配分の考え方(bet_type="both"の場合に払戻額を揃える等)も通常レースと同じ`;

const CRITERIA_SUGGESTION_RULES = `## 予想軸の追加提案

予想軸は固定ではない。渡されたデータを見て「この軸を追加すると回収率・的中率が上がりそうだ」と判断した場合は、
ユーザーからの指示を待たずに suggested_criteria で能動的に提案すること。判断材料がなければ空配列でよい。`;

const OUTPUT_FORMAT_RULES = `## 出力形式

説明文やMarkdownのコードフェンスを一切付けず、以下のJSONオブジェクトのみを出力すること。

{
  "race_rank": "S" | "A" | "B" | "C",
  "race_rank_reason": string,
  "predicted_bias": string,     // 想定トラックバイアス (例: 「内前有利、差しは届きにくい」)
  "entries": [
    {
      "horse_number": number,
      "horse_rank": "S" | "A" | "B" | "C",
      "horse_rank_comment": string,  // 短評、1行
      "is_kesshi": boolean,
      "kesshi_reason": string | null
    }
    // entries配列に含まれる全頭分を出力すること
  ],
  "honmei_horse_number": number | null,
  "aite_horse_number": number | null,
  "bet_type": "wide" | "umaren" | "both" | null,
  "bet_amount_wide": number | null,   // オッズが取得できる場合のみ、オッズ逆算による配分。取得不可ならnull
  "bet_amount_umaren": number | null,
  "analysis_level": string,     // 1. レース全体のレベル・層の厚さ
  "analysis_favorite": string,  // 2. 本命が堅い/危ない理由
  "analysis_rival": string,     // 3. 相手の根拠
  "analysis_value": string,     // 4. 妙味馬 (過小評価馬) が出る理由
  "analysis_pace": string,      // 5. ペース・展開想定 (前残り/差し決着のどちらが有力かを明言する)
  "suggested_criteria": [
    { "name": string, "target_level": "race" | "entry", "reason": string }
  ]
}`;

// standard(Sonnet): 血統/調教データは渡さない軽量tier。screening通過後の「軽い精査」役。
export const STANDARD_SYSTEM_PROMPT = [
  PHILOSOPHY_RULES,
  CORE_RULES,
  RACE_RANK_RULES,
  CRITERIA_SUGGESTION_RULES,
  OUTPUT_FORMAT_RULES,
].join("\n\n");

// premium(Opus): race_rankがA/Sだったレースのみ、血統・調教まで含めたフル調査で深掘りするtier。
export const PREMIUM_SYSTEM_PROMPT = [
  PHILOSOPHY_RULES,
  CORE_RULES,
  PEDIGREE_TRAINING_RULES,
  RACE_RANK_RULES,
  CRITERIA_SUGGESTION_RULES,
  OUTPUT_FORMAT_RULES,
].join("\n\n");

export const SCREENING_SYSTEM_PROMPT = `あなたは競馬予想の一次スクリーニング担当として、渡されたレースデータからそのレースへ深く投資する価値があるかをS/A/B/Cで素早く判定する。
詳細な個別馬診断は行わず、レース全体のレベル・荒れ具合・回収率の見込みだけで概算判定してよい。
- S: 価値・的中率とも高く、詳細診断に進む価値が高い
- A: 価値または的中率のどちらかが高い
- B: 標準的
- C: 見送り推奨、詳細診断は不要

極端な鉄板レース(1番人気のオッズが1.5倍前後など)は妙味が出る余地がほぼ無いためCとする。
少頭数レース(11頭以下)は払い戻しに期待できないため、他の条件によらず機械的にCとする。

説明文やMarkdownのコードフェンスを一切付けず、以下のJSONオブジェクトのみを出力すること。

{
  "race_rank": "S" | "A" | "B" | "C",
  "race_rank_reason": string
}`;

// ============================================================
// レースデータのペイロード構築 (system側のルールに対する入力データ)
// ============================================================

function serializeRace(race: RaceRow) {
  return {
    race_name: race.race_name,
    keibajo_name: race.keibajo_name,
    race_date: race.race_date,
    race_number: race.race_number,
    grade: race.grade,
    race_class: race.race_class,
    track_type: race.track_type,
    distance_m: race.distance_m,
    turn_direction: race.turn_direction,
    weather: race.weather,
    track_condition: race.track_condition,
    entry_count: race.entry_count,
    bias_note: race.bias_note,
  };
}

function serializeHorse(horse: HorseRow) {
  return {
    horse_name: horse.horse_name,
    sex: horse.sex,
    birth_date: horse.birth_date,
    sire_name: horse.sire_name,
    dam_name: horse.dam_name,
    dam_sire_name: horse.dam_sire_name,
    trainer_name: horse.trainer_name,
    trainer_affiliation: horse.trainer_affiliation,
  };
}

function serializePastPerformance(pp: PastPerformanceRow) {
  return {
    race_date: pp.race_date,
    keibajo_name: pp.keibajo_name,
    race_name: pp.race_name,
    grade: pp.grade,
    race_class: pp.race_class,
    track_type: pp.track_type,
    distance_m: pp.distance_m,
    track_condition: pp.track_condition,
    entry_count: pp.entry_count,
    post_position: pp.post_position,
    horse_number: pp.horse_number,
    jockey_name: pp.jockey_name,
    horse_weight_kg: pp.horse_weight_kg,
    horse_weight_diff_kg: pp.horse_weight_diff_kg,
    odds_win: pp.odds_win,
    popularity: pp.popularity,
    finish_position: pp.finish_position,
    margin_sec: pp.margin_sec,
    corner_positions: pp.corner_positions,
    pace_mark: pp.pace_mark,
    agari_3f_sec: pp.agari_3f_sec,
    bias_note: pp.bias_note,
    trouble_note: pp.trouble_note,
    level_verification_note: pp.level_verification_note,
  };
}

function serializePedigree(pedigree: HorsePedigreeRow | null) {
  if (!pedigree) return null;
  return {
    sire_name: pedigree.sire_name,
    dam_name: pedigree.dam_name,
    sire_sire_name: pedigree.sire_sire_name,
    sire_dam_name: pedigree.sire_dam_name,
    dam_sire_name: pedigree.dam_sire_name,
    dam_dam_name: pedigree.dam_dam_name,
    sire_sire_sire_name: pedigree.sire_sire_sire_name,
    sire_sire_dam_name: pedigree.sire_sire_dam_name,
    sire_dam_sire_name: pedigree.sire_dam_sire_name,
    sire_dam_dam_name: pedigree.sire_dam_dam_name,
    dam_sire_sire_name: pedigree.dam_sire_sire_name,
    dam_sire_dam_name: pedigree.dam_sire_dam_name,
    dam_dam_sire_name: pedigree.dam_dam_sire_name,
    dam_dam_dam_name: pedigree.dam_dam_dam_name,
  };
}

function serializeTrainingSession(session: TrainingSessionRow) {
  return {
    training_date: session.training_date,
    training_type: session.training_type,
    facility: session.facility,
    course_code: session.course_code,
    turn_direction: session.turn_direction,
    lap_times_sec: session.lap_times_sec,
    total_time_sec: session.total_time_sec,
    awase_uma: session.awase_uma,
    awase_result: session.awase_result,
    ashi_iro: session.ashi_iro,
    evaluator_comment: session.evaluator_comment,
  };
}

function serializePedigreeStat(stat: SireStatRow | NickStatRow) {
  return {
    stat_category: stat.stat_category,
    stat_key: stat.stat_key,
    starts: stat.starts,
    wins: stat.wins,
    win_rate: stat.win_rate,
    place_rate: stat.place_rate,
    roi_win_pct: stat.roi_win_pct,
  };
}

function serializeCriteriaScore(
  cs: { criteria: PredictionCriteriaRow; score: number | null; rank_mark: string | null; reason: string | null },
) {
  return {
    criteria_name: cs.criteria.name,
    score: cs.score,
    rank_mark: cs.rank_mark,
    reason: cs.reason,
  };
}

function serializeEntry(input: EntryDiagnosisInput) {
  return {
    post_position: input.entry.post_position,
    horse_number: input.entry.horse_number,
    horse: serializeHorse(input.horse),
    jockey_name: input.entry.jockey_name,
    jockey_weight_kg: input.entry.jockey_weight_kg,
    horse_weight_kg: input.entry.horse_weight_kg,
    horse_weight_diff_kg: input.entry.horse_weight_diff_kg,
    blinkers_change: input.entry.blinkers_change,
    equipment_note: input.entry.equipment_note,
    odds_win: input.entry.odds_win,
    expected_popularity: input.entry.expected_popularity,
    past_performances: input.pastPerformances.map(serializePastPerformance),
    pedigree: serializePedigree(input.pedigree),
    training_sessions: input.trainingSessions.map(serializeTrainingSession),
    sire_stats: input.sireStats.map(serializePedigreeStat),
    nick_stats: input.nickStats.map(serializePedigreeStat),
    criteria_scores: input.criteriaScores.map(serializeCriteriaScore),
  };
}

export function buildRaceDataPayload(input: RaceDiagnosisInput): string {
  const payload = {
    race: serializeRace(input.race),
    bias_reference_races: input.biasReferenceRaces.map((r) => ({
      race_date: r.raceDate,
      track_condition: r.trackCondition,
      bias_note: r.biasNote,
    })),
    race_criteria_scores: input.raceCriteriaScores.map(serializeCriteriaScore),
    entries: input.entries.map(serializeEntry),
  };
  return JSON.stringify(payload);
}

// screening(Haiku)用の軽量ペイロード。SCREENING_SYSTEM_PROMPTが要求するのは
// 「レース全体のレベル・荒れ具合・回収率の見込みだけの概算判定」(個別馬の深掘りではない)ため、
// buildRaceDataPayload()の血統/調教/種牡馬統計/過去走5走分は不要。オッズ・人気・頭数だけで
// 「鉄板レースか」「少頭数か」「荒れそうか」は十分判定できる(2026-07-13、実測コストが
// standardと同水準まで膨らんでいたため軽量化)。
function serializeScreeningEntry(input: EntryDiagnosisInput) {
  return {
    horse_number: input.entry.horse_number,
    post_position: input.entry.post_position,
    horse_name: input.horse.horse_name,
    odds_win: input.entry.odds_win,
    expected_popularity: input.entry.expected_popularity,
  };
}

export function buildScreeningPayload(input: RaceDiagnosisInput): string {
  const payload = {
    race: serializeRace(input.race),
    entries: input.entries.map(serializeScreeningEntry),
  };
  return JSON.stringify(payload);
}

// standard(Sonnet)用の中量ペイロード。STANDARD_SYSTEM_PROMPTは血統・調教データの扱いを
// 指示していない(PEDIGREE_TRAINING_RULESはpremium専用)ため、pedigree/training_sessions/
// sire_stats/nick_statsは渡さない。過去走もpremiumの5走ではなく直近3走に絞る
// (2026-07-13、A/S評価のレースだけpremiumでフル調査する二段階構成に変更したため)。
const STANDARD_PAST_PERFORMANCE_LIMIT = 3;

function serializeStandardEntry(input: EntryDiagnosisInput) {
  return {
    post_position: input.entry.post_position,
    horse_number: input.entry.horse_number,
    horse: serializeHorse(input.horse),
    jockey_name: input.entry.jockey_name,
    jockey_weight_kg: input.entry.jockey_weight_kg,
    horse_weight_kg: input.entry.horse_weight_kg,
    horse_weight_diff_kg: input.entry.horse_weight_diff_kg,
    blinkers_change: input.entry.blinkers_change,
    equipment_note: input.entry.equipment_note,
    odds_win: input.entry.odds_win,
    expected_popularity: input.entry.expected_popularity,
    past_performances: input.pastPerformances
      .slice(0, STANDARD_PAST_PERFORMANCE_LIMIT)
      .map(serializePastPerformance),
    criteria_scores: input.criteriaScores.map(serializeCriteriaScore),
  };
}

export function buildStandardPayload(input: RaceDiagnosisInput): string {
  const payload = {
    race: serializeRace(input.race),
    bias_reference_races: input.biasReferenceRaces.map((r) => ({
      race_date: r.raceDate,
      track_condition: r.trackCondition,
      bias_note: r.biasNote,
    })),
    race_criteria_scores: input.raceCriteriaScores.map(serializeCriteriaScore),
    entries: input.entries.map(serializeStandardEntry),
  };
  return JSON.stringify(payload);
}
