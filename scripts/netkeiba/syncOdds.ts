import { fetchNetkeibaJson } from "./httpClient";
import {
  parseWinOdds,
  parseComboOdds,
  extractOfficialDatetime,
  buildOddsApiUrl,
  buildShutubaRefererUrl,
  ODDS_TYPE_TANSHO,
  ODDS_TYPE_UMAREN,
  ODDS_TYPE_WIDE,
} from "./parseOdds";
import { createNetkeibaSyncClient } from "./supabaseClient";

// netkeibaのオッズAPIから単勝・馬連・ワイドを取得し、
//   race_entries.odds_win / expected_popularity
//   race_odds_combinations (data_source='netkeiba')
// へ反映する。JV-Link(Windows)経路が使えない時のオッズ取得手段。
//
// 既存のJV-Link経路と競合しないよう、**JV-Link由来の行は上書きしない**方針にはしていない
// (odds_winは同じ列を使うため後勝ちになる)。両方を同じ日に走らせる場合、netkeiba側の方が
// 発表時刻が古い可能性がある点に注意すること。通常はどちらか一方だけを使う運用を想定している。

export interface OddsSyncSummary {
  netkeibaRaceId: string;
  status: "ok" | "race_not_found" | "no_odds" | "fetch_failed";
  officialDatetime: string | null;
  entriesUpdated: number;
  combinationsUpserted: number;
}

export async function syncOddsForRaces(netkeibaRaceIds: string[]): Promise<OddsSyncSummary[]> {
  const supabase = createNetkeibaSyncClient();
  const summaries: OddsSyncSummary[] = [];

  for (const netkeibaRaceId of netkeibaRaceIds) {
    const summary: OddsSyncSummary = {
      netkeibaRaceId,
      status: "ok",
      officialDatetime: null,
      entriesUpdated: 0,
      combinationsUpserted: 0,
    };

    const { data: race, error: raceError } = await supabase
      .from("races")
      .select("id")
      .eq("jv_race_key", netkeibaRaceId)
      .maybeSingle();
    if (raceError) {
      console.warn(`[netkeiba-odds] races検索失敗 ${netkeibaRaceId}: ${raceError.message}`);
      summary.status = "fetch_failed";
      summaries.push(summary);
      continue;
    }
    if (!race) {
      summary.status = "race_not_found";
      summaries.push(summary);
      continue;
    }

    const referer = buildShutubaRefererUrl(netkeibaRaceId);

    // --- 単勝(オッズ+人気) ---
    const winJson = await fetchNetkeibaJson(buildOddsApiUrl(netkeibaRaceId, ODDS_TYPE_TANSHO), referer);
    if (!winJson) {
      summary.status = "fetch_failed";
      summaries.push(summary);
      continue;
    }
    summary.officialDatetime = extractOfficialDatetime(winJson);
    const winOdds = parseWinOdds(winJson);
    if (winOdds.length === 0) {
      // 発売前など、まだオッズが立っていないケース。エラーではないので静かに次へ。
      summary.status = "no_odds";
      summaries.push(summary);
      continue;
    }
    for (const row of winOdds) {
      const { error, count } = await supabase
        .from("race_entries")
        .update(
          { odds_win: row.oddsWin, expected_popularity: row.popularity || null },
          { count: "exact" },
        )
        .eq("race_id", race.id)
        .eq("horse_number", row.horseNumber);
      if (error) {
        console.warn(
          `[netkeiba-odds] race_entries更新失敗 ${netkeibaRaceId} 馬${row.horseNumber}: ${error.message}`,
        );
        continue;
      }
      summary.entriesUpdated += count ?? 0;
    }

    // --- 馬連・ワイド(組み合わせオッズ) ---
    const comboRows: Array<{
      race_id: string;
      bet_type: "umaren" | "wide";
      combination: string;
      odds: number | null;
      odds_low: number | null;
      odds_high: number | null;
      popularity: number | null;
      data_source: "netkeiba";
    }> = [];
    for (const [betType, type] of [
      ["umaren", ODDS_TYPE_UMAREN],
      ["wide", ODDS_TYPE_WIDE],
    ] as const) {
      const json = await fetchNetkeibaJson(buildOddsApiUrl(netkeibaRaceId, type), referer);
      if (!json) continue;
      for (const c of parseComboOdds(json, betType)) {
        comboRows.push({
          race_id: race.id,
          bet_type: c.betType,
          combination: c.combination,
          odds: c.odds,
          odds_low: c.oddsLow,
          odds_high: c.oddsHigh,
          popularity: c.popularity,
          data_source: "netkeiba",
        });
      }
    }
    // 1レースで馬連153+ワイド153程度になるためまとめてupsertする。
    const CHUNK = 200;
    for (let i = 0; i < comboRows.length; i += CHUNK) {
      const chunk = comboRows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("race_odds_combinations")
        .upsert(chunk, { onConflict: "race_id,bet_type,combination" });
      if (error) {
        console.warn(`[netkeiba-odds] 組み合わせオッズupsert失敗 ${netkeibaRaceId}: ${error.message}`);
        continue;
      }
      summary.combinationsUpserted += chunk.length;
    }

    console.log(
      `[netkeiba-odds] ${netkeibaRaceId}: 単勝${summary.entriesUpdated}頭 / 組み合わせ${summary.combinationsUpserted}件 (発表 ${summary.officialDatetime ?? "不明"})`,
    );
    summaries.push(summary);
  }

  return summaries;
}
