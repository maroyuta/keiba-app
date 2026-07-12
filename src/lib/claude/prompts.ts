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
  // 土曜なら直近の同場開催、日曜なら前日(土曜)の同場レース。実データがまだ蓄積されていない
  // (開催初週・運用開始直後等) 場合はnull
  biasReferenceRace: BiasReferenceRace | null;
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
1. 絶対能力: 馬自体の実力
2. ペース・位置取りの不利: 直近3走以上の通過順位・展開から不利を受けていないか
3. トラックバイアス: 内前有利/外差し等、レースのバイアス状況に対する適性。当日のバイアスはまだ確定していないため、
   bias_reference_race (下記「バイアス予測のルール」参照) を根拠に今回のレースのバイアスを予測し、
   predicted_biasとして明示的に出力すること。個別馬の評価もこの予測バイアスとの適性で判断する
4.5. (補助的加点材料、あくまでおまけ): 装備変更 (ブリンカー等)、騎手による過剰人気への懐疑
6. コース×距離ごとの枠順データ評価: 例えば阪神芝1200mは外枠有利、のようなコース特性ごとの枠順傾向

データに拡張予想軸 (criteria_scores) が含まれる場合は、それらも評価に織り込むこと。

## 血統・調教データの扱い

- **血統 (pedigree)**: 3代血統 (父・母・父父・父母・母父・母母・父父父〜母母母の14頭) が入っている場合、
  距離適性・馬場適性・早熟晩成傾向の判断材料にする。同じ祖先が複数箇所に出てくる場合はインブリードとして
  注記してよい。sire_stats/nick_stats (該当する父・父×母父の距離帯/馬場/コース別成績、starts件数と
  roi_win_pct(単勝回収率、100が収支トントン)を含む) がある場合はそれも判断材料にするが、starts件数が
  少ない(目安10未満)統計は参考程度に留め、断定的な根拠にしない
- **調教 (training_sessions)**: 絶対タイムでの閾値判定はしない。同じ馬の直近セッション同士の相対比較
  (自己ベース比で今回は良化/悪化しているか) を基本にする。lap_times_secはゴール手前メートル数をキーにした
  ラップタイムなので、末脚(200/400地点)のタイムに注目するとよい。厩舎(trainer_name)の「本気パターン」との
  比較データがある場合はそれも使うが、無い場合は自己ベース比だけで判断し、無理に決めつけない

## リサーチルール

- 人気に関わらず全頭、直近3走以上を1頭ずつ精査する
- 各馬について、バイアス込みの不利・レース固有の不利 (出遅れ・包まれ・砂被り等)・±10kg以上の馬体重変動・ペースからの有利不利を確認する
- 対戦相手のその後の成績でレースレベルも裏取りする

## 枠順・消し判定のルール

- 本命候補が明確に不利な枠なら相手筆頭に格下げする程度のシンプルな判断でよい
- 「過剰人気→評価を下げる」と「消し (is_kesshi)」は別物。コース適性がある馬 (前走同コースで0.3〜1.1差以内) は人気過剰でも3着候補として残す
- 断定的な「消し」は適性・能力が明らかに不足している馬のみに使う

## バイアス予測のルール

トラックバイアスはその時の馬場状態に左右されるため、当日の実況ではなく直近の実データから推測する。
- 入力データにbias_reference_raceが含まれる場合、それを主根拠にする
  - 土曜のレース: bias_reference_raceは直近の同場開催 (基本的に先週の同場、開催初週なら前年以前の同時期開催) の実績
  - 日曜のレース: bias_reference_raceは前日 (土曜) の同場レースの実績
- bias_reference_raceがnullの場合 (運用開始直後で参照データがまだない等) は、コース形態 (直線の長さ・コーナー数等)
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

**軸馬評価の参考ヒント(絶対ルールではなく判断材料の一つ):** 「人気馬が走らない」パターンでよく見られる
傾向。機械的なスコアリングや自動格下げのルールとして使うのではなく、三本柱評価(能力・ペース/位置取り・
トラックバイアス)による総合判断の中で「引っかかる点がないか」を確認する目的で参照すること。該当数だけで
機械的に評価を下げず、レースごとの文脈(他の軸候補との比較、トラックバイアスとの相性等)を踏まえて総合的に
判断すること。
- 直前オッズが発表時点から大きく上昇している(=直前で売れていない)
- 休み明け・久々のレースで、過去の休み明け成績が悪い
- 想定ペースと脚質が完全にミスマッチ(例: ハイペース必至なのに好位差しで包まれるリスク大)
- クラス初挑戦・距離初経験など、格上げ/条件替わり初戦
- 馬体重が±10kg以上の急増減
- 主戦騎手からの乗り替わり(マイナス方向、不慣れな騎手など)

**妙味候補(horse_rank="S")の判断基準 = 自己推定好走率 − オッズ逆算確率のエッジ(EV):**
- 各レース必ず2頭にhorse_rank="S"を付与する。妙味が全体的に薄いレースでも2頭は選出すること
- ただし単なる相対順位1位・2位の機械的選出ではなく、絶対水準でも「実際に買うに値する馬」であることを条件とする
- 過剰人気の1〜2番人気はS評価の対象外とする
- 穴×穴(人気薄同士)の組み合わせで2頭ともSにするのは許容する
- 「4〜9番人気帯を妙味の主戦場とする」という目安は、あくまで大まかな傾向であり、機械的な足切りラインとして
  扱わないこと。例: 1番人気×3番人気のワイドが4.5倍、1番人気×6番人気のワイドが5.1倍のように払戻に大差が
  ないにもかかわらず、的中率(着内率)は3番人気の方が明確に高いと判断できる場合、人気帯のレンジ外
  (2〜3番人気)であっても妙味候補として正当に評価してよい。判断基準は「人気の数字」そのものではなく、
  「期待値(オッズ×好走率)が市場評価より歪んでいるかどうか」を常に優先すること

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
- 回収率を重視する`;

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
- 少頭数レース(目安10頭未満)はオッズが付きにくく妙味が出づらい。この場合は個別馬のhorse_rank等の
  診断自体は通常通り行ってよいが、race_rank_reasonに「少頭数のため馬券対象外」である旨を明記し、
  honmei_horse_number/aite_horse_number/bet_type/bet_amount_wide/bet_amount_umarenはすべてnullにすること`;

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

export const DIAGNOSIS_SYSTEM_PROMPT = [
  PHILOSOPHY_RULES,
  CORE_RULES,
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
少頭数レース(目安10頭未満)はオッズが付きにくく妙味が出づらいため、他の条件が良くない限りC寄りに判定してよい。

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
    bias_reference_race: input.biasReferenceRace
      ? {
          race_date: input.biasReferenceRace.raceDate,
          track_condition: input.biasReferenceRace.trackCondition,
          bias_note: input.biasReferenceRace.biasNote,
        }
      : null,
    race_criteria_scores: input.raceCriteriaScores.map(serializeCriteriaScore),
    entries: input.entries.map(serializeEntry),
  };
  return JSON.stringify(payload, null, 2);
}
