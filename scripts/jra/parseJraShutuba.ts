import * as cheerio from "cheerio";

export interface JraHorseOdds {
  jvHorseId: string; // horses.jv_horse_idと同一(JRA側は"00"+jv_horse_idの12桁で管理)
  oddsWin: number | null;
  popularity: number | null;
}

export interface ParsedJraShutuba {
  raceDate: string; // YYYY-MM-DD
  keibajoCode: string; // '01'-'10' (jv_race_key/horses.jv_horse_idと同じコード体系)
  raceNumber: number;
  raceName: string | null;
  horses: JraHorseOdds[];
  // 同ページ内で発見できた他レースへのaccessD.html CNAME URL(相対パス、絶対URL化は呼び出し側)。
  // 同一開催場の1〜12R + 他開催場の注目レース(通常11R、今日/明日分)が載っている。
  siblingUrls: string[];
}

// JRAのCNAMEは "pw01dde01" + 開催場コード(2桁) + 謎の8桁 + レース番号(2桁) + 日付(8桁) + "/" + チェックサム(2桁)
// という並びで、末尾8桁が対象レースの開催日(YYYYMMDD)であることを実データで確認済み(2026-07-17)。
const CNAME_PATTERN = /CNAME=pw01dde01(\d{2})(\d{8})(\d{2})(\d{8})\/([0-9A-Za-z]{2})/;

export function parseCnameFromUrl(url: string): { keibajoCode: string; raceNumber: number; raceDate: string } | null {
  const m = url.match(CNAME_PATTERN);
  if (!m) return null;
  const [, keibajoCode, , raceNumberStr, dateStr] = m;
  const raceDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  return { keibajoCode, raceNumber: Number(raceNumberStr), raceDate };
}

export function parseJraShutubaHtml(html: string, sourceUrl: string): ParsedJraShutuba | null {
  const $ = cheerio.load(html);
  const meta = parseCnameFromUrl(sourceUrl);
  if (!meta) return null;

  const raceNumberImg = $('.race_number img[alt$="レース"]').first().attr("alt");
  const raceNumber = raceNumberImg ? Number(raceNumberImg.replace("レース", "")) : meta.raceNumber;
  const raceName = $(".race_name").first().text().trim() || null;

  const horses: JraHorseOdds[] = [];
  $("td.horse").each((_, el) => {
    const $cell = $(el);
    const horseLink = $cell.find('a[href*="accessU.html"]').first().attr("href");
    const idMatch = horseLink?.match(/CNAME=pw01dud00(\d{10})\//);
    if (!idMatch) return;

    const oddsText = $cell.find(".odds .num").first().text().trim();
    const popText = $cell.find(".odds .pop_rank").first().text().trim();
    const oddsWin = /^\d+(\.\d+)?$/.test(oddsText) ? Number(oddsText) : null;
    const popMatch = popText.match(/(\d+)/);

    horses.push({
      jvHorseId: idMatch[1],
      oddsWin,
      popularity: popMatch ? Number(popMatch[1]) : null,
    });
  });

  const siblingUrls = new Set<string>();
  $('a[href*="accessD.html?CNAME="]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) siblingUrls.add(href);
  });

  return {
    raceDate: meta.raceDate,
    keibajoCode: meta.keibajoCode,
    raceNumber,
    raceName,
    horses,
    siblingUrls: [...siblingUrls],
  };
}
