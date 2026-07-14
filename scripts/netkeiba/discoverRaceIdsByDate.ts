import * as cheerio from "cheerio";
import { fetchNetkeibaHtml } from "./httpClient";

// race.netkeiba.com/top/race_list.html(開催カレンダー画面)が裏で呼んでいるAJAX断片URL。
// current_groupパラメータ(開催週を表す内部ID)は省略しても同じ結果が返ることを実データで確認済み
// (2026-07-13)。未来日は枠順確定前でも6日前程度からレース名・出走馬(枠番/馬番は空欄)が掲載され
// 始める。過去日は開催された全レースがそのまま載る(shutuba.html/result.html両方の入口として使う)。
function buildRaceListUrl(kaisaiDate: string): string {
  return `https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=${kaisaiDate}`;
}

// 指定日(YYYYMMDD、過去・未来どちらでも可)に開催されるレースのrace_id(=jv_race_key)一覧を取得する。
// まだnetkeiba側にも掲載されていない日付・レース番号は含まれない(空配列/部分的な結果を返す)。
export async function discoverRaceIdsByDate(kaisaiDate: string): Promise<string[]> {
  const html = await fetchNetkeibaHtml(buildRaceListUrl(kaisaiDate));
  if (!html) return [];

  const $ = cheerio.load(html);
  const raceIds = new Set<string>();
  $('a[href*="race_id="]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const match = href.match(/race_id=(\d{12})/);
    if (match) raceIds.add(match[1]);
  });
  return [...raceIds].sort();
}
