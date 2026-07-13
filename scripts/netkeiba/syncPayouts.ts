import type { Database } from "@/lib/supabase/database.types";
import { fetchNetkeibaHtml } from "./httpClient";
import { parsePayoutsHtml, parseRaceResultHtml, type ParsedPayout } from "./parseRaceResult";
import { createNetkeibaSyncClient } from "./supabaseClient";

// race_payouts(実際の配当)をnetkeiba経由で埋める。JV-Data(HR)がWindows/JV-Link専用のため、
// Mac単独でバックテストのサンプルを増やしたい場合の代替経路として2026-07-13に新設。
// 馬単・3連単は着順(順序)が的中条件そのもので、単純な組番ソートでは保存できないため対象外
// (parseRaceResult.tsのROW_CLASS_TO_BET_TYPE参照、このアプリはワイド・馬連しか使わないため実害なし)。
//
// ⚠️2026-07-13、同日中に追加: 07-11分をバックテストに使おうとしたところ、race_entries.odds_win/
// actual_popularityがJV-Link側の同期で全馬0のまま(確定タイミングの問題と推測、原因はWindows側で
// 要確認)だったことが判明した。同じ結果ページに単勝オッズ・確定人気も載っているため、payout取得と
// 同じfetchのついでにrace_entriesも更新する(ネットワークリクエストの追加なし)。

export interface PayoutSyncSummary {
  raceId: string;
  status: "ok" | "fetch_failed" | "parse_failed" | "race_not_found";
  upserted: number;
  entriesUpdated: number;
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
      summaries.push({ raceId, status: "fetch_failed", upserted: 0, entriesUpdated: 0 });
      continue;
    }

    let payouts: ParsedPayout[];
    try {
      payouts = parsePayoutsHtml(html);
    } catch (err) {
      console.warn(`[netkeiba] payout parse失敗 race_id=${raceId}:`, err);
      summaries.push({ raceId, status: "parse_failed", upserted: 0, entriesUpdated: 0 });
      continue;
    }
    if (payouts.length === 0) {
      summaries.push({ raceId, status: "parse_failed", upserted: 0, entriesUpdated: 0 });
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
      summaries.push({ raceId, status: "race_not_found", upserted: 0, entriesUpdated: 0 });
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
      summaries.push({ raceId, status: "fetch_failed", upserted: 0, entriesUpdated: 0 });
      continue;
    }

    // race_entries.odds_win/actual_popularity/finish_position/finish_time_secが未確定(0)のまま
    // のことがあるため、同じ結果ページから確定済みの値で埋める(horse_numberで突き合わせ)。
    // 2026-07-13、当初odds_win/actual_popularityのみ更新していたが、07-11分はfinish_positionも
    // 0のままだったと判明したため追加した(バックテストのROI判定自体はrace_payoutsとの照合のため
    // 影響なかったが、着順の表示・分析ができていなかった)。
    let entriesUpdated = 0;
    const parsedResult = parseRaceResultHtml(html, raceId);
    if (parsedResult) {
      for (const horse of parsedResult.horses) {
        if (horse.horseNumber === null || horse.oddsWin === null) continue;
        const { error: entryUpdateError } = await supabase
          .from("race_entries")
          .update({
            odds_win: horse.oddsWin,
            actual_popularity: horse.popularity,
            finish_position: horse.finishPosition,
            finish_time_sec: horse.finishTimeSec,
          })
          .eq("race_id", race.id)
          .eq("horse_number", horse.horseNumber);
        if (entryUpdateError) {
          console.warn(
            `[netkeiba] race_entries更新失敗 race_id=${raceId} horse_number=${horse.horseNumber}:`,
            entryUpdateError.message,
          );
          continue;
        }
        entriesUpdated += 1;
      }
    }
    summaries.push({ raceId, status: "ok", upserted: rows.length, entriesUpdated });
  }

  return summaries;
}
