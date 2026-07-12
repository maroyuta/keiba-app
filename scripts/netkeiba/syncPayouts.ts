import type { Database } from "@/lib/supabase/database.types";
import { fetchNetkeibaHtml } from "./httpClient";
import { parsePayoutsHtml, type ParsedPayout } from "./parseRaceResult";
import { createNetkeibaSyncClient } from "./supabaseClient";

// race_payouts(実際の配当)をnetkeiba経由で埋める。JV-Data(HR)がWindows/JV-Link専用のため、
// Mac単独でバックテストのサンプルを増やしたい場合の代替経路として2026-07-13に新設。
// 馬単・3連単は着順(順序)が的中条件そのもので、単純な組番ソートでは保存できないため対象外
// (parseRaceResult.tsのROW_CLASS_TO_BET_TYPE参照、このアプリはワイド・馬連しか使わないため実害なし)。

export interface PayoutSyncSummary {
  raceId: string;
  status: "ok" | "fetch_failed" | "parse_failed" | "race_not_found";
  upserted: number;
}

function buildResultUrl(raceId: string): string {
  return `https://race.netkeiba.com/race/result.html?race_id=${raceId}`;
}

export async function syncPayouts(raceIds: string[]): Promise<PayoutSyncSummary[]> {
  const supabase = createNetkeibaSyncClient();
  const summaries: PayoutSyncSummary[] = [];

  for (const raceId of raceIds) {
    const url = buildResultUrl(raceId);
    console.log(`[netkeiba] fetching ${url}`);

    const html = await fetchNetkeibaHtml(url);
    if (!html) {
      summaries.push({ raceId, status: "fetch_failed", upserted: 0 });
      continue;
    }

    let payouts: ParsedPayout[];
    try {
      payouts = parsePayoutsHtml(html);
    } catch (err) {
      console.warn(`[netkeiba] payout parse失敗 race_id=${raceId}:`, err);
      summaries.push({ raceId, status: "parse_failed", upserted: 0 });
      continue;
    }
    if (payouts.length === 0) {
      summaries.push({ raceId, status: "parse_failed", upserted: 0 });
      continue;
    }

    const { data: race, error: raceLookupError } = await supabase
      .from("races")
      .select("id")
      .eq("jv_race_key", raceId)
      .maybeSingle();
    if (raceLookupError) {
      throw new Error(`races検索に失敗: ${raceLookupError.message}`);
    }
    if (!race) {
      summaries.push({ raceId, status: "race_not_found", upserted: 0 });
      continue;
    }

    const rows: Database["public"]["Tables"]["race_payouts"]["Insert"][] = payouts.map((p) => ({
      race_id: race.id,
      bet_type: p.betType,
      combination: p.combination,
      payout_yen: p.payoutYen,
      popularity: p.popularity,
      data_source: "netkeiba",
    }));

    const { error: upsertError } = await supabase
      .from("race_payouts")
      .upsert(rows, { onConflict: "race_id,bet_type,combination" });

    if (upsertError) {
      console.warn(`[netkeiba] race_payouts upsert失敗 race_id=${raceId}:`, upsertError.message);
      summaries.push({ raceId, status: "fetch_failed", upserted: 0 });
      continue;
    }
    summaries.push({ raceId, status: "ok", upserted: rows.length });
  }

  return summaries;
}
