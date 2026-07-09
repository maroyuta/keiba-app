import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { screenRace, diagnoseRaceStandard, diagnoseRacePremium } from "@/lib/claude/predict";
import type { UsageInfo } from "@/lib/claude/predict";
import type { RaceDiagnosisInput, DiagnosisResult, BiasReferenceRace } from "@/lib/claude/prompts";
import type { RaceRow, UsageLogTier } from "@/lib/supabase/database.types";

// Sonnet(standard)は数十秒、Opus(premium, xhigh effort)は実測で約200秒かかることを確認済み。
// Vercel Hobbyプランはmaxduraiton上限が60秒で固定 (この値を超えて指定しても60秒でハードタイムアウトする)。
// premium診断はHobbyプランでは確実にタイムアウトするため、Proプラン(300秒、Fluid Computeで800秒まで
// 延長可)への切り替えが実質必須。詳細はAGENTS.mdの「開発ステータス」を参照。
export const maxDuration = 300;

type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

// リサーチルール: 直近3走以上を精査する。余裕を持って5走分取得する。
const PAST_PERFORMANCE_LIMIT = 5;

// トラックバイアスはその時の馬場状態次第のため、直近の実データを根拠にする。
// - 日曜のレース: 前日(土曜)の同場レースを参照
// - それ以外 (基本的に土曜): 直近の同場開催 (先週の同場。開催初週なら前年以前の同時期開催まで遡る) を参照
// bias_noteが未診断でnullのレースは参照候補から除外する (診断済みレースのみが実データを持つため)。
async function findBiasReferenceRace(
  supabase: SupabaseAdminClient,
  race: RaceRow,
): Promise<{ id: string; reference: BiasReferenceRace } | null> {
  const raceDate = new Date(`${race.race_date}T00:00:00Z`);
  const dayOfWeek = raceDate.getUTCDay(); // 0=日, 6=土

  let query = supabase
    .from("races")
    .select("id, race_date, track_condition, bias_note")
    .eq("keibajo_code", race.keibajo_code)
    .neq("id", race.id)
    .not("bias_note", "is", null)
    .lt("race_date", race.race_date)
    .order("race_date", { ascending: false })
    .limit(1);

  if (dayOfWeek === 0) {
    const saturday = new Date(raceDate);
    saturday.setUTCDate(saturday.getUTCDate() - 1);
    const saturdayStr = saturday.toISOString().slice(0, 10);
    query = supabase
      .from("races")
      .select("id, race_date, track_condition, bias_note")
      .eq("keibajo_code", race.keibajo_code)
      .eq("race_date", saturdayStr)
      .not("bias_note", "is", null)
      .limit(1);
  }

  const { data } = await query.maybeSingle();
  if (!data) return null;

  return {
    id: data.id,
    reference: {
      raceDate: data.race_date,
      trackCondition: data.track_condition,
      biasNote: data.bias_note,
    },
  };
}

async function loadRaceDiagnosisInput(
  supabase: SupabaseAdminClient,
  raceId: string,
): Promise<{ input: RaceDiagnosisInput; biasReferenceRaceId: string | null } | null> {
  const { data: race } = await supabase.from("races").select("*").eq("id", raceId).single();
  if (!race) return null;

  const { data: entries } = await supabase
    .from("race_entries")
    .select("*, horses(*)")
    .eq("race_id", raceId);
  if (!entries || entries.length === 0) return null;

  const horseIds = entries.map((entry) => entry.horse_id);
  const entryIds = entries.map((entry) => entry.id);

  const { data: pastPerformances } = await supabase
    .from("past_performances")
    .select("*")
    .in("horse_id", horseIds)
    .order("race_date", { ascending: false });

  const pastByHorse = new Map<string, NonNullable<typeof pastPerformances>>();
  for (const pp of pastPerformances ?? []) {
    const list = pastByHorse.get(pp.horse_id) ?? [];
    if (list.length < PAST_PERFORMANCE_LIMIT) {
      list.push(pp);
      pastByHorse.set(pp.horse_id, list);
    }
  }

  const { data: entryCriteriaScores } = await supabase
    .from("race_entry_criteria_scores")
    .select("*, prediction_criteria(*)")
    .in("race_entry_id", entryIds);

  const criteriaByEntry = new Map<
    string,
    Array<NonNullable<typeof entryCriteriaScores>[number]>
  >();
  for (const cs of entryCriteriaScores ?? []) {
    const list = criteriaByEntry.get(cs.race_entry_id) ?? [];
    list.push(cs);
    criteriaByEntry.set(cs.race_entry_id, list);
  }

  const { data: raceCriteriaScores } = await supabase
    .from("race_criteria_scores")
    .select("*, prediction_criteria(*)")
    .eq("race_id", raceId);

  const biasReference = await findBiasReferenceRace(supabase, race);

  return {
    input: {
      race,
      entries: entries.map((entry) => ({
        entry,
        horse: entry.horses,
        pastPerformances: pastByHorse.get(entry.horse_id) ?? [],
        criteriaScores: (criteriaByEntry.get(entry.id) ?? []).map((cs) => ({
          ...cs,
          criteria: cs.prediction_criteria,
        })),
      })),
      raceCriteriaScores: (raceCriteriaScores ?? []).map((rc) => ({
        ...rc,
        criteria: rc.prediction_criteria,
      })),
      biasReferenceRace: biasReference?.reference ?? null,
    },
    biasReferenceRaceId: biasReference?.id ?? null,
  };
}

async function logUsage(
  supabase: SupabaseAdminClient,
  raceId: string,
  tier: UsageLogTier,
  usage: UsageInfo,
): Promise<void> {
  const { error } = await supabase.from("api_usage_log").insert({
    race_id: raceId,
    tier,
    model: usage.model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_creation_input_tokens: usage.cacheCreationInputTokens,
    cache_read_input_tokens: usage.cacheReadInputTokens,
    estimated_cost_usd: usage.estimatedCostUsd,
  });
  if (error) {
    console.warn(`[usage] api_usage_log書き込み失敗 (${tier}):`, error.message);
  }
}

async function persistDiagnosis(
  supabase: SupabaseAdminClient,
  raceId: string,
  input: RaceDiagnosisInput,
  result: DiagnosisResult,
  biasReferenceRaceId: string | null,
): Promise<void> {
  await supabase
    .from("races")
    .update({
      race_rank: result.race_rank,
      race_rank_reason: result.race_rank_reason,
      bias_note: result.predicted_bias,
      bias_reference_race_id: biasReferenceRaceId,
      honmei_horse_number: result.honmei_horse_number,
      aite_horse_number: result.aite_horse_number,
      bet_type: result.bet_type,
      bet_amount_wide: result.bet_amount_wide,
      bet_amount_umaren: result.bet_amount_umaren,
      analysis_level: result.analysis_level,
      analysis_favorite: result.analysis_favorite,
      analysis_rival: result.analysis_rival,
      analysis_value: result.analysis_value,
      analysis_pace: result.analysis_pace,
    })
    .eq("id", raceId);

  const entryIdByHorseNumber = new Map(
    input.entries.map((e) => [e.entry.horse_number, e.entry.id]),
  );

  await Promise.all(
    result.entries.map((entryResult) => {
      const entryId = entryIdByHorseNumber.get(entryResult.horse_number);
      if (!entryId) return Promise.resolve();
      return supabase
        .from("race_entries")
        .update({
          horse_rank: entryResult.horse_rank,
          horse_rank_comment: entryResult.horse_rank_comment,
          is_kesshi: entryResult.is_kesshi,
          kesshi_reason: entryResult.kesshi_reason,
        })
        .eq("id", entryId);
    }),
  );
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await context.params;
  const supabase = createAdminClient();

  const loaded = await loadRaceDiagnosisInput(supabase, raceId);
  if (!loaded) {
    return NextResponse.json({ error: "race not found" }, { status: 404 });
  }
  const { input, biasReferenceRaceId } = loaded;

  // 一次スクリーニング (Haiku) でC評価なら、コスト削減のためここで打ち切る。
  const screening = await screenRace(input);
  await logUsage(supabase, raceId, "screening", screening.usage);
  if (screening.result.race_rank === "C") {
    await supabase
      .from("races")
      .update({
        race_rank: screening.result.race_rank,
        race_rank_reason: screening.result.race_rank_reason,
        bias_reference_race_id: biasReferenceRaceId,
      })
      .eq("id", raceId);
    return NextResponse.json({
      tier: "screening",
      race_rank: screening.result.race_rank,
      race_rank_reason: screening.result.race_rank_reason,
    });
  }

  // 標準診断 (Sonnet)。ここでS評価が出た場合のみ「本気で買う」レースとしてOpusへ再診断させる。
  let diagnosis = await diagnoseRaceStandard(input);
  await logUsage(supabase, raceId, "standard", diagnosis.usage);
  let tier: "standard" | "premium" = "standard";
  if (diagnosis.result.race_rank === "S") {
    diagnosis = await diagnoseRacePremium(input);
    await logUsage(supabase, raceId, "premium", diagnosis.usage);
    tier = "premium";
  }

  await persistDiagnosis(supabase, raceId, input, diagnosis.result, biasReferenceRaceId);

  return NextResponse.json({ tier, result: diagnosis.result });
}
