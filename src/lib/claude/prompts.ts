import type {
  RaceRow,
  HorseRow,
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

## 馬券方針

- ワイド・馬連のみを対象とする。3連複は買わない
- 買い目は「本命→相手1頭」の1点に絞る (honmei_horse_number → aite_horse_number)
- 回収率を重視する`;

const RACE_RANK_RULES = `## レース投資判断

診断表作成前に、レース自体をS/A/B/Cで評価する (race_rank)。個別馬のランクとは別軸。
- S: 価値・的中率とも高い
- A: 価値または的中率のどちらかが高い
- B: 標準的、投資判断は任意
- C: 見送り推奨`;

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
