import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchNetkeibaHtml } from "./httpClient";
import { parseHorseHistoryHtml } from "./parseHorseHistory";

// db.netkeiba.com/horse/result/{netkeiba馬ID}/ を馬単位で取得し、その馬の全レース履歴を
// past_performancesへ一括反映する。race.netkeiba.com由来のsyncPastPerformances(レース単位)
// と違い、自前のracesテーブルがカバーしていない期間の過去走も一度に取れる利点がある
// (netkeiba側の馬IDはhorses.jv_horse_idと同一という前提、README参照)。

function createSyncClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が環境変数に設定されていません",
    );
  }
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface HorseHistorySyncSummary {
  jvHorseId: string;
  status: "ok" | "fetch_failed" | "no_data";
  upserted: number;
}

function buildHorseResultUrl(jvHorseId: string): string {
  return `https://db.netkeiba.com/horse/result/${jvHorseId}/`;
}

export async function syncHorseHistory(jvHorseIds: string[]): Promise<HorseHistorySyncSummary[]> {
  const supabase = createSyncClient();
  const summaries: HorseHistorySyncSummary[] = [];

  // jv_horse_id -> 内部horses.id の解決 (一括)
  const { data: horses, error: horseLookupError } = await supabase
    .from("horses")
    .select("id, jv_horse_id")
    .in("jv_horse_id", jvHorseIds);
  if (horseLookupError) {
    throw new Error(`horses検索に失敗: ${horseLookupError.message}`);
  }
  const internalIdByJvId = new Map(horses.map((h) => [h.jv_horse_id, h.id]));

  for (const jvHorseId of jvHorseIds) {
    const internalHorseId = internalIdByJvId.get(jvHorseId);
    if (!internalHorseId) {
      summaries.push({ jvHorseId, status: "no_data", upserted: 0 });
      continue;
    }

    const url = buildHorseResultUrl(jvHorseId);
    console.log(`[netkeiba] fetching ${url}`);
    const html = await fetchNetkeibaHtml(url, "euc-jp");
    if (!html) {
      summaries.push({ jvHorseId, status: "fetch_failed", upserted: 0 });
      continue;
    }

    const entries = parseHorseHistoryHtml(html);
    if (entries.length === 0) {
      summaries.push({ jvHorseId, status: "no_data", upserted: 0 });
      continue;
    }

    let upserted = 0;
    for (const entry of entries) {
      const row: Database["public"]["Tables"]["past_performances"]["Insert"] = {
        horse_id: internalHorseId,
        data_source: "netkeiba",
        source_url: url,
        race_date: entry.raceDate,
        keibajo_code: entry.keibajoCode,
        keibajo_name: entry.keibajoName,
        race_number: entry.raceNumber,
        race_name: entry.raceName,
        grade: null,
        race_class: null,
        track_type: entry.trackType,
        distance_m: entry.distanceM,
        track_condition: entry.trackCondition,
        weather: entry.weather,
        entry_count: entry.entryCount,
        post_position: entry.postPosition,
        horse_number: entry.horseNumber,
        jockey_name: entry.jockeyName,
        jockey_weight_kg: entry.jockeyWeightKg,
        horse_weight_kg: entry.horseWeightKg,
        horse_weight_diff_kg: entry.horseWeightDiffKg,
        odds_win: entry.oddsWin,
        popularity: entry.popularity,
        finish_position: entry.finishPosition,
        finish_time_sec: entry.finishTimeSec,
        margin_sec: entry.marginSec,
        corner_positions: entry.cornerPositions,
        pace_mark: null,
        agari_3f_sec: entry.agari3fSec,
      };

      const { error: upsertError } = await supabase
        .from("past_performances")
        .upsert(row, { onConflict: "horse_id,race_date,keibajo_code,race_number" });
      if (upsertError) {
        console.warn(`[netkeiba] upsert失敗 horse_id=${internalHorseId} race=${entry.raceId}:`, upsertError.message);
        continue;
      }
      upserted += 1;
    }

    summaries.push({ jvHorseId, status: "ok", upserted });
  }

  return summaries;
}
