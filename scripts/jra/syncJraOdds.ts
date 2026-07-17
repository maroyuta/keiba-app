import { fetchJraHtml } from "./httpClient";
import { parseJraShutubaHtml, parseCnameFromUrl, type ParsedJraShutuba } from "./parseJraShutuba";
import { createNetkeibaSyncClient } from "../netkeiba/supabaseClient";

export interface JraOddsSyncSummary {
  url: string;
  status: "ok" | "fetch_failed" | "parse_failed" | "race_not_found" | "skipped_wrong_date";
  keibajoCode?: string;
  raceNumber?: number;
  oddsUpdated: number;
}

const JRA_ORIGIN = "https://www.jra.go.jp";

function toAbsoluteUrl(href: string): string {
  return href.startsWith("http") ? href : `${JRA_ORIGIN}${href}`;
}

// 指定した1レース分のオッズ・人気を、既存のrace_entries(枠順確定済み)へ反映する。
// races/horsesの新規作成は行わない(枠順・過去走・血統は既存のnetkeiba経由フローに任せ、
// ここはオッズ・人気の上書きのみに責務を限定する)。
async function syncOneRace(
  supabase: ReturnType<typeof createNetkeibaSyncClient>,
  parsed: ParsedJraShutuba,
  url: string,
): Promise<JraOddsSyncSummary> {
  const { data: race, error: raceError } = await supabase
    .from("races")
    .select("id")
    .eq("race_date", parsed.raceDate)
    .eq("keibajo_code", parsed.keibajoCode)
    .eq("race_number", parsed.raceNumber)
    .maybeSingle();
  if (raceError) throw new Error(`races検索に失敗: ${raceError.message}`);
  if (!race) {
    return { url, status: "race_not_found", keibajoCode: parsed.keibajoCode, raceNumber: parsed.raceNumber, oddsUpdated: 0 };
  }

  const withOdds = parsed.horses.filter((h) => h.oddsWin !== null || h.popularity !== null);
  let oddsUpdated = 0;

  if (withOdds.length > 0) {
    // 1頭ずつ問い合わせるとレース1件あたり最大2N回の往復になりタイムアウトしやすいため、
    // horses検索は.in()で一括取得する(実データで馬数の多いレースがタイムアウトすることを確認済み、2026-07-17)。
    const { data: horseRows, error: horsesError } = await supabase
      .from("horses")
      .select("id, jv_horse_id")
      .in(
        "jv_horse_id",
        withOdds.map((h) => h.jvHorseId),
      );
    if (horsesError) throw new Error(`horses検索に失敗: ${horsesError.message}`);

    const horseIdByJvId = new Map((horseRows ?? []).map((h) => [h.jv_horse_id, h.id]));

    for (const horse of withOdds) {
      const horseId = horseIdByJvId.get(horse.jvHorseId);
      if (!horseId) continue;

      const { error: updateError, count } = await supabase
        .from("race_entries")
        .update(
          { odds_win: horse.oddsWin, expected_popularity: horse.popularity },
          { count: "exact" },
        )
        .eq("race_id", race.id)
        .eq("horse_id", horseId);
      if (updateError) throw new Error(`race_entries更新に失敗: ${updateError.message}`);
      if (count) oddsUpdated += count;
    }
  }

  return {
    url,
    status: "ok",
    keibajoCode: parsed.keibajoCode,
    raceNumber: parsed.raceNumber,
    oddsUpdated,
  };
}

// startUrlから同一開催場の1〜12R・他開催場の注目レースへのリンクを芋づる式に辿り、
// targetDate(YYYY-MM-DD)に一致するレースのみオッズを同期する。BFS、訪問済みは重複取得しない。
export async function crawlAndSyncJraOdds(
  startUrl: string,
  targetDate: string,
): Promise<JraOddsSyncSummary[]> {
  const supabase = createNetkeibaSyncClient();
  const visited = new Set<string>();
  const queue: string[] = [startUrl];
  const summaries: JraOddsSyncSummary[] = [];

  while (queue.length > 0) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const meta = parseCnameFromUrl(url);
    if (meta && meta.raceDate !== targetDate) {
      summaries.push({ url, status: "skipped_wrong_date", oddsUpdated: 0 });
      continue;
    }

    const html = await fetchJraHtml(url);
    if (!html) {
      summaries.push({ url, status: "fetch_failed", oddsUpdated: 0 });
      continue;
    }
    const parsed = parseJraShutubaHtml(html, url);
    if (!parsed) {
      summaries.push({ url, status: "parse_failed", oddsUpdated: 0 });
      continue;
    }

    try {
      summaries.push(await syncOneRace(supabase, parsed, url));
    } catch (err) {
      console.warn(`[jra] ${url} の同期に失敗:`, err);
      summaries.push({ url, status: "fetch_failed", oddsUpdated: 0 });
    }

    for (const href of parsed.siblingUrls) {
      const abs = toAbsoluteUrl(href);
      if (!visited.has(abs)) queue.push(abs);
    }
  }

  return summaries;
}
