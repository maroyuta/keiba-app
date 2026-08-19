import type { EntryDiagnosisInput, RaceDiagnosisInput } from "@/lib/claude/prompts";
import type { PastPerformanceRow } from "@/lib/supabase/database.types";

// ============================================================
// 適性スコア群 (2026-08-19、ユーザー要望「全部数値化」)
//
// 設計思想はバイアス適合度スコア(2026-08-19、PR #3)と同じ:
// **LLMには一切判断させず、客観データからコード側で決定論的に計算する。**
// LLMの役割は「数値を読んで総合判断する」ことであり、「脚質が向いてるか」「格上挑戦か」
// といった曖昧な言語判断を毎回やり直させない。
//
// ★重要な設計変更(2026-08-19): これらのスコアは診断結果への「後付けの注記」ではなく、
// **LLM呼び出し前のペイロードに入力として渡す**。従来のannotateBiasFitScores/
// annotateRaceLevelGapsはpersistDiagnosis内=LLMが本命/相手を決めた"後"に実行されており、
// LLMはスコアを一度も見ないまま判断していた(=数値化した意味が無かった)。
//
// スコアの共通仕様:
// - すべて -100〜+100 の範囲。**プラス=今回のレースで有利、マイナス=不利**で符号を統一する。
// - 判定に必要なデータが無い場合は 0 ではなく null を返す(「不利」と「不明」を混同しない)。
// - 個々のスコアは単独で買い/消しを決めるものではなく、LLMが総合判断するための材料。
// ============================================================

const CONFIDENCE_WEIGHT: Record<string, number> = { high: 1.0, medium: 0.65, low: 0.35 };
// course_bias_profileの確信度は日本語ラベル(compute_course_bias.py由来)。
const JP_CONFIDENCE_WEIGHT: Record<string, number> = { 高: 1.0, 中: 0.65, 低: 0.35 };

function clamp100(n: number): number {
  return Math.max(-100, Math.min(100, Math.round(n)));
}

function parseCornerPositions(cornerPositions: string | null): number[] {
  if (!cornerPositions) return [];
  return cornerPositions
    .split(/[-–]/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

// 序盤(先頭2コーナー)の位置取りを頭数で正規化した比率。0に近いほど前、1に近いほど後方。
// inferRunningStyle(逃げ/先行/差し/追込の4値)と違い連続値なので、閾値の境界で判定が
// 飛ぶことがなく、スコアのグラデーションがそのまま出る。
function positionRatioOf(pp: PastPerformanceRow): number | null {
  const positions = parseCornerPositions(pp.corner_positions);
  if (positions.length === 0) return null;
  const early = positions.slice(0, 2);
  const earlyAvg = early.reduce((a, b) => a + b, 0) / early.length;
  const field = pp.entry_count && pp.entry_count > 0 ? pp.entry_count : 14;
  return earlyAvg / field;
}

// その馬の常用脚質を表す位置取り比率(直近3走平均)。pastPerformancesはrace_date降順前提。
export function getTypicalPositionRatio(entry: EntryDiagnosisInput): number | null {
  const ratios = entry.pastPerformances
    .filter((pp) => !!pp.corner_positions && !!pp.entry_count)
    .slice(0, 3)
    .map(positionRatioOf)
    .filter((r): r is number => r !== null);
  if (ratios.length === 0) return null;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

// 「前寄り度」。+100=最も前、-100=最も後方。バイアス適合度・隊列スコアの共通の土台。
function forwardnessOf(ratio: number): number {
  return (0.5 - ratio) * 200;
}

// 1走の「どれだけ良く走ったか」を頭数で正規化して-100〜+100にする。
// 1着=+100、ちょうど中位=0、最下位=-100。着順そのものより頭数を考慮できるのが利点
// (8頭立ての4着と18頭立ての4着を同じに扱わない)。
function finishPercentile(pp: PastPerformanceRow): number | null {
  const finish = pp.finish_position;
  const field = pp.entry_count;
  if (finish === null || finish <= 0 || !field || field < 2) return null;
  const pct = 1 - (finish - 1) / (field - 1);
  return clamp100((pct - 0.5) * 200);
}

export interface SubsetFit {
  score: number | null; // その条件での平均パフォーマンス(-100〜+100)
  starts: number;       // 該当する過去走の本数(少ないほど信頼度が低い)
}

function subsetFit(pps: PastPerformanceRow[], predicate: (pp: PastPerformanceRow) => boolean): SubsetFit {
  const matched = pps.filter(predicate);
  const scores = matched.map(finishPercentile).filter((s): s is number => s !== null);
  if (scores.length === 0) return { score: null, starts: matched.length };
  return { score: clamp100(scores.reduce((a, b) => a + b, 0) / scores.length), starts: scores.length };
}

// ============================================================
// 1. 脚質×トラックバイアス適合度 (既存、2026-08-19 PR #3から移設)
// ============================================================

export function computeBiasFitScore(
  entry: EntryDiagnosisInput,
  biasStyle: "front" | "back" | "flat" | null | undefined,
  biasConfidence: "high" | "medium" | "low" | null | undefined,
): number | null {
  if (!biasStyle || biasStyle === "flat") return 0;
  const ratio = getTypicalPositionRatio(entry);
  if (ratio === null) return null;
  const direction = biasStyle === "front" ? 1 : -1;
  const weight = CONFIDENCE_WEIGHT[biasConfidence ?? "low"] ?? 0.35;
  return clamp100(forwardnessOf(ratio) * direction * weight);
}

// ============================================================
// 2. 枠順適合度
//
// course_bias_profile(compute_course_bias.pyが週次算出、会場×芝ダ×距離の多年集計)の
// 内枠/外枠有利ラベル×確信度と、今回の枠番を突き合わせる。
// ⚠️race_entries.post_positionは馬番(umaban)ではなく**枠番(wakuban、1〜8)**である
// (AGENTS.md 2026-08-01の記録: entry_count/2を閾値にして全頭「内枠」と誤判定した事故あり)。
// 頭数によって使われる枠数が変わるため、固定の8ではなく出走馬中の最大枠番で正規化する。
// ============================================================

export function computeDrawFitScore(
  entry: EntryDiagnosisInput,
  input: RaceDiagnosisInput,
): number | null {
  const profile = input.courseBiasProfile;
  if (!profile || !profile.waku_label || profile.waku_label === "フラット") return 0;
  const myWaku = entry.entry.post_position;
  if (myWaku === null || myWaku <= 0) return null;
  const allWaku = input.entries
    .map((e) => e.entry.post_position)
    .filter((p): p is number => p !== null && p > 0);
  const maxWaku = allWaku.length > 0 ? Math.max(...allWaku) : 8;
  if (maxWaku < 2) return null;
  // 0=最内、1=最外 → +100=最内、-100=最外
  const innerness = (0.5 - (myWaku - 1) / (maxWaku - 1)) * 200;
  const direction = profile.waku_label === "内枠有利" ? 1 : profile.waku_label === "外枠有利" ? -1 : 0;
  if (direction === 0) return 0;
  const weight = JP_CONFIDENCE_WEIGHT[profile.waku_confidence ?? "低"] ?? 0.35;
  return clamp100(innerness * direction * weight);
}

// ============================================================
// 3. メンバー構成から見た想定隊列・位置取りの取りやすさ
//
// ユーザー要望(2026-08-19)「そのメンバー構成ならどの位置で走れるか・有利な位置で走れるか」。
// バイアス適合度が「馬場がどちらに向くか」なのに対し、こちらは「今回のメンバーの中で
// その位置を取れるのか(先行争いが激しくないか)」という別軸。両方揃って初めて
// 「今回この馬がどこを走れるか」が数値で言える。
//
// 例: 常に逃げる馬でも、同型が5頭いれば楽に前へ行けず消耗する(マイナス)。
//     逆に追込馬は、前が飽和してハイペースになるほど展開が向く(プラス)。
// ============================================================

export interface FieldContext {
  field_size: number;
  front_runner_count: number;      // 常用位置取りが前(比率0.30以下)の頭数
  pace_label: "S" | "M" | "H";     // 先行勢の密度から機械推定した想定ペース
  known_style_count: number;       // 脚質を判定できた頭数(推定の信頼度の目安)
}

const FRONT_RATIO_THRESHOLD = 0.30;

export function computeFieldContext(input: RaceDiagnosisInput): FieldContext {
  const ratios = input.entries
    .map((e) => getTypicalPositionRatio(e))
    .filter((r): r is number => r !== null);
  const frontRunnerCount = ratios.filter((r) => r <= FRONT_RATIO_THRESHOLD).length;
  // 頭数に対する先行勢の割合で想定ペースを機械推定する(頭数が違えば同じ4頭でも意味が違うため)。
  const density = ratios.length > 0 ? frontRunnerCount / ratios.length : 0;
  const paceLabel: FieldContext["pace_label"] = density >= 0.30 ? "H" : density <= 0.12 ? "S" : "M";
  return {
    field_size: input.entries.length,
    front_runner_count: frontRunnerCount,
    pace_label: paceLabel,
    known_style_count: ratios.length,
  };
}

// 想定した隊列の中で「その馬が前から何番目に位置を取りそうか」。1=最も前を取りそう。
export function computeProjectedPositionRank(
  entry: EntryDiagnosisInput,
  input: RaceDiagnosisInput,
): number | null {
  const myRatio = getTypicalPositionRatio(entry);
  if (myRatio === null) return null;
  const ahead = input.entries.filter((e) => {
    const r = getTypicalPositionRatio(e);
    return r !== null && r < myRatio;
  }).length;
  return ahead + 1;
}

// 先行勢の「典型的な」密度。5頭に1頭が先行型くらいが標準的な隊列という想定で、
// これを上回るほど前が混雑し、下回るほど前が楽になる。
const NEUTRAL_FRONT_DENSITY = 0.20;
const LEAD_EASE_GAIN = 250;

// 位置取りの取りやすさ。先行馬は同型が少ないほどプラス、追込馬は前が飽和するほどプラス
// (ハイペースになり展開が向く)。「その馬の前寄り度」×「先行争いの緩さ」の積なので、
// 先行型と追込型で符号が自然に反転する。
//
// ⚠️先行争いの激しさは**絶対頭数ではなく頭数に対する密度**で測る(2026-08-19に修正)。
// 当初は「同型2頭までは楽」という固定閾値にしていたが、6頭立てで先行3頭(=半分が前)という
// 明確なハイペース想定の隊列で、先行馬のスコアが0(中立)になる不具合が出た。同じ「同型2頭」でも
// 6頭立てと18頭立てでは意味が正反対であり、field_context.pace_labelは密度で判定しているのに
// このスコアだけ絶対数で判定していたため、両者が矛盾していた。密度に統一して整合させる。
export function computePositionEaseScore(
  entry: EntryDiagnosisInput,
  input: RaceDiagnosisInput,
): number | null {
  const myRatio = getTypicalPositionRatio(entry);
  if (myRatio === null) return null;
  const ratios = input.entries
    .map((e) => getTypicalPositionRatio(e))
    .filter((r): r is number => r !== null);
  if (ratios.length === 0) return null;
  const frontDensity = ratios.filter((r) => r <= FRONT_RATIO_THRESHOLD).length / ratios.length;
  const leadEase = (NEUTRAL_FRONT_DENSITY - frontDensity) * LEAD_EASE_GAIN;
  const forwardness = forwardnessOf(myRatio); // +100=前、-100=後方
  return clamp100((forwardness / 100) * leadEase);
}

// ============================================================
// 4. 条件適性(距離・馬場種別・コース・馬場状態)
//
// 「距離を走った経験がある」という事実自体は評価材料にしない(AGENTS.md 2026-08-02の方針)
// ため、経験の有無ではなく**その条件で実際にどう走ったか**をパフォーマンスで数値化する。
// startsを併記して、1〜2走しかない条件のスコアをLLMが過信しないようにする。
// ============================================================

// 距離適性の「近い距離」判定。±12%(1600mなら±192m)を同系統とみなす。
const DISTANCE_BAND_RATIO = 0.12;
const HEAVY_CONDITIONS = new Set(["重", "不良"]);

export interface AptitudeFit {
  distance: SubsetFit;   // 今回と近い距離帯での成績
  surface: SubsetFit;    // 今回と同じ芝/ダートでの成績
  venue: SubsetFit;      // 今回と同じ競馬場での成績
  going: SubsetFit;      // 今回と同じ馬場状態グループ(良〜稍重 / 重〜不良)での成績
}

export function computeAptitudeFit(
  entry: EntryDiagnosisInput,
  input: RaceDiagnosisInput,
): AptitudeFit {
  const pps = entry.pastPerformances;
  const todayDistance = input.race.distance_m;
  const todaySurface = input.race.track_type;
  const todayVenue = input.race.keibajo_code;
  const todayHeavy = input.race.track_condition ? HEAVY_CONDITIONS.has(input.race.track_condition) : null;

  return {
    distance: todayDistance
      ? subsetFit(pps, (pp) =>
          pp.distance_m !== null &&
          Math.abs(pp.distance_m - todayDistance) <= todayDistance * DISTANCE_BAND_RATIO)
      : { score: null, starts: 0 },
    surface: todaySurface
      ? subsetFit(pps, (pp) => pp.track_type === todaySurface)
      : { score: null, starts: 0 },
    venue: todayVenue
      ? subsetFit(pps, (pp) => pp.keibajo_code === todayVenue)
      : { score: null, starts: 0 },
    going: todayHeavy === null
      ? { score: null, starts: 0 }
      : subsetFit(pps, (pp) =>
          !!pp.track_condition && HEAVY_CONDITIONS.has(pp.track_condition) === todayHeavy),
  };
}

// ============================================================
// 5. レースレベル差(格上挑戦・古馬混合初挑戦)
//
// 2026-08-19に一次実装(PR #4)したが、ユーザー指摘
// 「GIII8着とOP1着で点数の上限決まってるなら正当な評価できない」を受けて改良。
// 従来は「出走したクラスの最高値」をそのまま証明済みレベルにしていたため、
// GIIIで大敗した馬(88点)がOPで勝った馬(70点)より格上と評価されてしまっていた。
// **実効レベル = クラス点 + そのレースでの着順パフォーマンス補正** に変更し、
// 「出ただけ」と「通用した」を区別する。
// ============================================================

interface RaceLevelTier {
  tierPoints: number;
  ageOpen: boolean; // 古馬混合戦(「◯歳以上」)か、世代限定戦か
  label: string;
}

export function classifyRaceLevelFromName(raceName: string | null): RaceLevelTier | null {
  if (!raceName) return null;
  const ageOpen = /以上/.test(raceName);
  // (GIII)は(GII)を部分文字列として含むため、長い表記から先に判定する。
  if (/\(GIII\)|\(Jpn3\)/.test(raceName)) return { tierPoints: 88, ageOpen, label: "G3" };
  if (/\(GII\)|\(Jpn2\)/.test(raceName)) return { tierPoints: 94, ageOpen, label: "G2" };
  if (/\(GI\)|\(Jpn1\)/.test(raceName)) return { tierPoints: 100, ageOpen, label: "G1" };
  if (/\(重賞\)/.test(raceName)) return { tierPoints: 80, ageOpen, label: "重賞(格付不明)" };
  if (/\(L\)/.test(raceName)) return { tierPoints: 76, ageOpen, label: "リステッド" };
  if (/\(OP\)|オープン/.test(raceName)) return { tierPoints: 70, ageOpen, label: "オープン" };
  if (/3勝|３勝|1600万/.test(raceName)) return { tierPoints: 65, ageOpen, label: "3勝クラス" };
  if (/2勝|２勝|1000万/.test(raceName)) return { tierPoints: 50, ageOpen, label: "2勝クラス" };
  if (/1勝|１勝|500万/.test(raceName)) return { tierPoints: 30, ageOpen, label: "1勝クラス" };
  if (/未勝利/.test(raceName)) return { tierPoints: 10, ageOpen, label: "未勝利" };
  if (/新馬/.test(raceName)) return { tierPoints: 8, ageOpen, label: "新馬" };
  return null;
}

export function classifyTodayRaceLevel(race: RaceDiagnosisInput["race"]): RaceLevelTier | null {
  const ageOpen = !!race.race_class && /以上/.test(race.race_class);
  if (race.grade === "G1") return { tierPoints: 100, ageOpen, label: "G1" };
  if (race.grade === "G2") return { tierPoints: 94, ageOpen, label: "G2" };
  if (race.grade === "G3") return { tierPoints: 88, ageOpen, label: "G3" };
  const text = race.race_class ?? "";
  if (/オープン/.test(text)) return { tierPoints: 70, ageOpen, label: "オープン" };
  if (/３勝クラス|3勝クラス|収得賞金1600万円以下/.test(text)) return { tierPoints: 65, ageOpen, label: "3勝クラス" };
  if (/２勝クラス|2勝クラス|収得賞金1000万円以下/.test(text)) return { tierPoints: 50, ageOpen, label: "2勝クラス" };
  if (/１勝クラス|1勝クラス|収得賞金500万円以下/.test(text)) return { tierPoints: 30, ageOpen, label: "1勝クラス" };
  if (/未勝利/.test(text)) return { tierPoints: 10, ageOpen, label: "未勝利" };
  if (/新馬/.test(text)) return { tierPoints: 8, ageOpen, label: "新馬" };
  return null;
}

// クラス点への着順補正。「そのクラスに出走した」と「そのクラスで通用した」を分ける。
// 勝ち=クラス相応かそれ以上、僅差=ほぼ通用、大敗=そのクラスの実力とは認めない。
function levelPerformanceAdjustment(pp: PastPerformanceRow): number {
  const margin = pp.margin_sec;
  if (margin !== null) {
    if (margin <= 0) return 8;      // 勝利
    if (margin <= 0.5) return 0;    // 僅差=そのクラスで通用
    if (margin <= 1.5) return -12;  // やや離された
    return -25;                     // 大敗=そのクラスを走った実績としては認めない
  }
  const finish = pp.finish_position;
  const field = pp.entry_count;
  if (finish !== null && finish > 0 && field && field >= 2) {
    if (finish === 1) return 8;
    if (finish <= 3) return 0;
    if (finish <= Math.ceil(field / 2)) return -12;
    return -25;
  }
  return -12; // 着順不明は中間的に割り引く(不明を有利に扱わない)
}

export interface RaceLevelGap {
  gap_points: number;              // 今回クラス点 - 実効証明済みレベル。プラスほど格上挑戦
  proven_label: string;            // 実効的に最も通用していたクラス
  proven_effective_points: number; // 着順補正後の証明済みレベル
  today_label: string;
  first_time_vs_older: boolean;    // 今回が古馬混合戦なのに、古馬混合戦の出走歴が無い
}

export function computeRaceLevelGap(
  entry: EntryDiagnosisInput,
  race: RaceDiagnosisInput["race"],
): RaceLevelGap | null {
  const today = classifyTodayRaceLevel(race);
  if (!today) return null;

  const classified = entry.pastPerformances
    .map((pp) => ({ tier: classifyRaceLevelFromName(pp.race_name), pp }))
    .filter((x): x is { tier: RaceLevelTier; pp: PastPerformanceRow } => x.tier !== null);

  if (classified.length === 0) {
    // クラスを判別できる過去走が一本も無い=実績未証明。最大限に警戒する側へ倒す。
    return {
      gap_points: today.tierPoints,
      proven_label: "実績なし/不明",
      proven_effective_points: 0,
      today_label: today.label,
      first_time_vs_older: today.ageOpen,
    };
  }

  // ★実効レベル = クラス点 + 着順補正。これにより「GIII8着」より「OP1着」が上に来る。
  const effective = classified.map((x) => ({
    points: x.tier.tierPoints + levelPerformanceAdjustment(x.pp),
    label: x.tier.label,
  }));
  const best = effective.reduce((a, b) => (b.points > a.points ? b : a));
  const provenAgeOpen = classified.some((x) => x.tier.ageOpen);

  return {
    gap_points: Math.round(today.tierPoints - best.points),
    proven_label: best.label,
    proven_effective_points: Math.round(best.points),
    today_label: today.label,
    first_time_vs_older: today.ageOpen && !provenAgeOpen,
  };
}

// ============================================================
// 6. 出走馬1頭ぶんの全スコアを束ねる(ペイロード投入用)
// ============================================================

export interface EntryFitScores {
  bias_fit: number | null;
  draw_fit: number | null;
  position_ease: number | null;
  projected_position_rank: number | null;
  typical_position_ratio: number | null;
  aptitude: AptitudeFit;
  level_gap: RaceLevelGap | null;
}

// biasStyle/biasConfidenceは診断前(ペイロード構築時)にはLLMの出力がまだ無いため、
// course_bias_profile(週次バッチが算出した多年の構造的傾向)から代替する。
// 診断後のガード側では、LLMが実際に出力したpredicted_bias_styleを使って再計算する。
export function courseProfileToBiasStyle(
  input: RaceDiagnosisInput,
): { style: "front" | "back" | "flat" | null; confidence: "high" | "medium" | "low" | null } {
  const p = input.courseBiasProfile;
  if (!p || !p.style_label) return { style: null, confidence: null };
  const style =
    p.style_label === "前有利" ? "front" : p.style_label === "後方有利" ? "back" : "flat";
  const confidence =
    p.style_confidence === "高" ? "high" : p.style_confidence === "中" ? "medium" : "low";
  return { style, confidence };
}

// ============================================================
// 7. 期待値(EV)の算出
//
// これまで「妙味(EV)」はプロンプトに106回書かれていたのに、期待値の掛け算をするコードは
// 1行も無かった(LLMが文章で「過小評価されている」と言うだけで、検算も反証もできなかった)。
// LLMには「本命と相手が両方3着以内に入る確率(%)」という検証可能な数値だけを出させ、
// 実際のワイドオッズと突き合わせた期待値の計算は**コード側で行う**。
//
// なぜワイドの複勝圏確率を聞くのか: ワイド馬券が払い戻される条件そのものだから。
// 「確信度70点」のような尺度と違い、後から「25%と言った買い目は本当に25%当たったか」を
// 実績(race_recommendation_results.is_hit)と突き合わせて検証・較正できる。
// ============================================================

// JRAのワイド・馬連の控除率は22.5%。つまり市場が完全に効率的でも払戻期待値は0.775にしかならない。
// 市場の想定確率を逆算する際はこの控除率を戻す必要がある(単純な1/oddsだと控除率のぶん過大になる)。
export const JRA_TAKEOUT_WIDE = 0.225;

export interface BetExpectedValue {
  estimatedProbability: number;     // LLM推定(%)
  marketImpliedProbability: number; // 市場が believe している確率(%) = (1-控除率)/オッズ
  breakEvenProbability: number;     // 損益分岐に必要な確率(%) = 100/オッズ
  wideOddsUsed: number;             // 判定に使ったワイドオッズ(下限=最悪ケース)
  expectedValue: number;            // 推定確率 × オッズ。1.0が損益分岐
  edgePoints: number;               // 推定確率 - 損益分岐確率(パーセントポイント)。EV>1と符号が一致する
}

// ワイドは[下限,上限]の範囲で払い戻されるため、**下限(最悪ケース)**で期待値を判定する。
// 上限で判定すると実際には出ない配当を前提に買うことになり、EVを 系統的に過大評価する。
export function computeBetExpectedValue(
  estimatedProbabilityPct: number | null | undefined,
  wideOddsLow: number | null,
): BetExpectedValue | null {
  if (estimatedProbabilityPct === null || estimatedProbabilityPct === undefined) return null;
  if (wideOddsLow === null || wideOddsLow <= 0) return null;
  const p = Math.max(0, Math.min(100, estimatedProbabilityPct)) / 100;
  // 市場が believe している確率。パリミュチュエルでは、ある組み合わせに賭けられた金額の割合が
  // そのまま市場の予想確率であり、それは (1-控除率)/オッズ になる。
  const marketImplied = (1 - JRA_TAKEOUT_WIDE) / wideOddsLow;
  // 損益分岐に必要な確率。市場と同じ見立て(=marketImplied)で買うと、控除率のぶんちょうど負ける
  // (EV=0.775)。**勝つには市場より 1/(1-控除率) ≒ 1.29倍 正確でなければならない。**
  // edgePointsはこの損益分岐に対する差分にする(市場想定に対する差分にすると、
  // 「エッジはプラスなのにEVは1未満」という一見矛盾した表示になり判断を誤らせるため)。
  const breakEven = 1 / wideOddsLow;
  return {
    estimatedProbability: Math.round(p * 1000) / 10,
    marketImpliedProbability: Math.round(marketImplied * 1000) / 10,
    breakEvenProbability: Math.round(breakEven * 1000) / 10,
    wideOddsUsed: wideOddsLow,
    expectedValue: Math.round(p * wideOddsLow * 1000) / 1000,
    edgePoints: Math.round((p - breakEven) * 1000) / 10,
  };
}

// EVをrace_priority_score(0〜100の整数)へ写像する。capDailySRank/capDailyBuyCandidatesは
// この列の降順で「今日買う4〜6レース」を選ぶため、ここが実際の期待値順になることで
// 「予測力の無い自己申告スコアで買うレースを選んでいた」問題が解消される。
// EV=1.0(損益分岐)を60点に置き、EV=1.67以上で満点になる線形写像。
export function expectedValueToPriorityScore(expectedValue: number): number {
  return Math.max(0, Math.min(100, Math.round(expectedValue * 60)));
}

export function computeEntryFitScores(
  entry: EntryDiagnosisInput,
  input: RaceDiagnosisInput,
): EntryFitScores {
  const { style, confidence } = courseProfileToBiasStyle(input);
  const ratio = getTypicalPositionRatio(entry);
  return {
    bias_fit: computeBiasFitScore(entry, style, confidence),
    draw_fit: computeDrawFitScore(entry, input),
    position_ease: computePositionEaseScore(entry, input),
    projected_position_rank: computeProjectedPositionRank(entry, input),
    typical_position_ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
    aptitude: computeAptitudeFit(entry, input),
    level_gap: computeRaceLevelGap(entry, input.race),
  };
}
