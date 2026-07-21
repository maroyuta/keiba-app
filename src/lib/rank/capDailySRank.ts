import type { createAdminClient } from "@/lib/supabase/admin";

// 「Sは1日最大4つまで」(2026-07-19、ユーザー指示)。診断がSを付けたレースが増えるほど
// 「結局どれを買えばいいか」が分からなくなるため、race_priority_score(妙味の強さ・的中率・
// オッズを踏まえた自己申告の連続値、prompts.tsのRACE_RANK_RULES参照)の高い順に上位
// MAX_DAILY_S_RANK件だけSを残し、それ以外はAへ格下げする。重賞は「race_rankによらず
// 問答無用で購入」ルールがあるため、Aへ格下げされても購入判断そのものには影響しない。
export const MAX_DAILY_S_RANK = 4;

// 「Aも多い」(2026-07-19、ユーザー指示)。S単独の上限だけでは「S+Aの合計」が
// ユーザーの運用(1日5〜6レース)を超えてしまう問題は解決しないため、S+A合計でも
// MAX_DAILY_BUY_CANDIDATES件までに絞り、選外はBへ格下げする。capDailySRankで
// Sの格下げ(→A)が先に確定してから呼ぶこと(格下げ後のA込みで合計を数える必要があるため)。
export const MAX_DAILY_BUY_CANDIDATES = 6;

type AdminClient = ReturnType<typeof createAdminClient>;

export async function capDailySRank(
  supabase: AdminClient,
  raceDate: string,
): Promise<{ demoted: number }> {
  const { data: sRaces, error } = await supabase
    .from("races")
    .select("id, race_priority_score, race_rank_reason")
    .eq("race_date", raceDate)
    .eq("race_rank", "S");
  if (error) {
    throw new Error(`S評価レースの取得に失敗: ${error.message}`);
  }

  const rows = sRaces ?? [];
  if (rows.length <= MAX_DAILY_S_RANK) {
    return { demoted: 0 };
  }

  const sorted = [...rows].sort(
    (a, b) => (b.race_priority_score ?? -1) - (a.race_priority_score ?? -1),
  );
  const toDemote = sorted.slice(MAX_DAILY_S_RANK);

  for (const race of toDemote) {
    const note = `[1日のS評価は上位${MAX_DAILY_S_RANK}件までのため、race_priority_score順で選外となりAへ格下げ]`;
    const { error: updateError } = await supabase
      .from("races")
      .update({
        race_rank: "A",
        race_rank_reason: race.race_rank_reason ? `${race.race_rank_reason} ${note}` : note,
      })
      .eq("id", race.id);
    if (updateError) {
      throw new Error(`race_rank格下げに失敗 race_id=${race.id}: ${updateError.message}`);
    }
  }

  return { demoted: toDemote.length };
}

export async function capDailyBuyCandidates(
  supabase: AdminClient,
  raceDate: string,
): Promise<{ demoted: number }> {
  const { data: candidates, error } = await supabase
    .from("races")
    .select("id, race_priority_score, race_rank_reason")
    .eq("race_date", raceDate)
    .in("race_rank", ["S", "A"]);
  if (error) {
    throw new Error(`S/A評価レースの取得に失敗: ${error.message}`);
  }

  const rows = candidates ?? [];
  if (rows.length <= MAX_DAILY_BUY_CANDIDATES) {
    return { demoted: 0 };
  }

  const sorted = [...rows].sort(
    (a, b) => (b.race_priority_score ?? -1) - (a.race_priority_score ?? -1),
  );
  const toDemote = sorted.slice(MAX_DAILY_BUY_CANDIDATES);

  for (const race of toDemote) {
    const note = `[1日のS+A評価は上位${MAX_DAILY_BUY_CANDIDATES}件までのため、race_priority_score順で選外となりBへ格下げ]`;
    const { error: updateError } = await supabase
      .from("races")
      .update({
        race_rank: "B",
        race_rank_reason: race.race_rank_reason ? `${race.race_rank_reason} ${note}` : note,
      })
      .eq("id", race.id);
    if (updateError) {
      throw new Error(`race_rank格下げに失敗 race_id=${race.id}: ${updateError.message}`);
    }
  }

  return { demoted: toDemote.length };
}
