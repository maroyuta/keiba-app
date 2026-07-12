import type { Database } from "@/lib/supabase/database.types";
import { fetchNetkeibaHtml } from "./httpClient";
import { parseRaceResultHtml, type ParsedRaceResult } from "./parseRaceResult";
import { createNetkeibaSyncClient } from "./supabaseClient";

export interface SyncSummary {
  raceId: string;
  status: "ok" | "fetch_failed" | "parse_failed";
  upserted: number;
  skippedUnknownHorses: string[];
}

function buildResultUrl(raceId: string): string {
  return `https://race.netkeiba.com/race/result.html?race_id=${raceId}`;
}

async function upsertParsedResult(
  supabase: ReturnType<typeof createNetkeibaSyncClient>,
  parsed: ParsedRaceResult,
  raceId: string,
): Promise<{ upserted: number; skippedUnknownHorses: string[] }> {
  const netkeibaHorseIds = parsed.horses.map((h) => h.netkeibaHorseId);

  // netkeiba側の馬IDはJV-Data血統登録番号 (horses.jv_horse_id) と同一という前提でマッチングする。
  // (中央競馬所属馬の場合の一般的な慣行だが、要検証。一致しない馬はスキップしログに残す)
  const { data: matchedHorses, error: horseLookupError } = await supabase
    .from("horses")
    .select("id, jv_horse_id")
    .in("jv_horse_id", netkeibaHorseIds);

  if (horseLookupError) {
    throw new Error(`horses検索に失敗: ${horseLookupError.message}`);
  }

  const horseIdByJvId = new Map(matchedHorses.map((h) => [h.jv_horse_id, h.id]));
  const skippedUnknownHorses: string[] = [];
  let upserted = 0;

  for (const horse of parsed.horses) {
    const internalHorseId = horseIdByJvId.get(horse.netkeibaHorseId);
    if (!internalHorseId) {
      // グレースフルデグラデーション: horsesにまだ登録されていない馬は同期をスキップし処理を継続する
      skippedUnknownHorses.push(`${horse.netkeibaHorseId} (${horse.horseName})`);
      continue;
    }

    const row: Database["public"]["Tables"]["past_performances"]["Insert"] = {
      horse_id: internalHorseId,
      data_source: "netkeiba",
      source_url: buildResultUrl(raceId),
      race_date: parsed.meta.raceDate,
      keibajo_code: parsed.meta.keibajoCode,
      keibajo_name: parsed.meta.keibajoName,
      race_number: parsed.meta.raceNumber,
      race_name: parsed.meta.raceName,
      grade: parsed.meta.grade,
      race_class: parsed.meta.raceClass,
      track_type: parsed.meta.trackType,
      distance_m: parsed.meta.distanceM,
      track_condition: parsed.meta.trackCondition,
      weather: parsed.meta.weather,
      entry_count: parsed.meta.entryCount,
      post_position: horse.postPosition,
      horse_number: horse.horseNumber,
      jockey_name: horse.jockeyName,
      jockey_weight_kg: horse.jockeyWeightKg,
      horse_weight_kg: horse.horseWeightKg,
      horse_weight_diff_kg: horse.horseWeightDiffKg,
      odds_win: horse.oddsWin,
      popularity: horse.popularity,
      finish_position: horse.finishPosition,
      finish_time_sec: horse.finishTimeSec,
      margin_sec: horse.marginSec,
      corner_positions: horse.cornerPositions,
      pace_mark: parsed.meta.paceMark,
      agari_3f_sec: horse.agari3fSec,
    };

    const { error: upsertError } = await supabase
      .from("past_performances")
      .upsert(row, { onConflict: "horse_id,race_date,keibajo_code,race_number" });

    if (upsertError) {
      console.warn(`[netkeiba] upsert失敗 horse_id=${internalHorseId}:`, upsertError.message);
      continue;
    }
    upserted += 1;
  }

  return { upserted, skippedUnknownHorses };
}

// レースIDのリストを順番に (レート制限を守りながら) 同期する。
// 1件の失敗が全体を止めないよう、各レースごとにtry/catchで握りつぶして次に進む。
export async function syncPastPerformances(raceIds: string[]): Promise<SyncSummary[]> {
  const supabase = createNetkeibaSyncClient();
  const summaries: SyncSummary[] = [];

  for (const raceId of raceIds) {
    const url = buildResultUrl(raceId);
    console.log(`[netkeiba] fetching ${url}`);

    const html = await fetchNetkeibaHtml(url);
    if (!html) {
      summaries.push({ raceId, status: "fetch_failed", upserted: 0, skippedUnknownHorses: [] });
      continue;
    }

    let parsed: ParsedRaceResult | null;
    try {
      parsed = parseRaceResultHtml(html, raceId);
    } catch (err) {
      console.warn(`[netkeiba] parse失敗 race_id=${raceId}:`, err);
      parsed = null;
    }
    if (!parsed) {
      summaries.push({ raceId, status: "parse_failed", upserted: 0, skippedUnknownHorses: [] });
      continue;
    }

    try {
      const { upserted, skippedUnknownHorses } = await upsertParsedResult(supabase, parsed, raceId);
      summaries.push({ raceId, status: "ok", upserted, skippedUnknownHorses });
    } catch (err) {
      console.warn(`[netkeiba] DB書き込み失敗 race_id=${raceId}:`, err);
      summaries.push({ raceId, status: "fetch_failed", upserted: 0, skippedUnknownHorses: [] });
    }
  }

  return summaries;
}
