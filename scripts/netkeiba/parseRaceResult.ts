import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { TrackCondition, TrackType, PaceMark } from "@/lib/supabase/database.types";

// race.netkeiba.com/race/result.html?race_id=XXXXXXXXXXXX の実HTML構造 (2026-07時点) を元にした
// パーサー。netkeiba側のマークアップ変更で壊れる可能性があるため、定期的な動作確認が必要。

export interface ParsedRaceMeta {
  raceDate: string; // YYYY-MM-DD
  keibajoCode: string; // '01'-'10'
  keibajoName: string | null;
  raceNumber: number | null;
  raceName: string | null;
  grade: string | null;
  raceClass: string | null;
  trackType: TrackType | null;
  distanceM: number | null;
  trackCondition: TrackCondition | null;
  weather: string | null;
  entryCount: number | null;
  paceMark: PaceMark | null;
}

export interface ParsedHorseResult {
  netkeibaHorseId: string; // netkeiba側の10桁馬ID (JV-Data血統登録番号と同一の想定、要検証)
  horseName: string;
  postPosition: number | null;
  horseNumber: number | null;
  jockeyName: string | null;
  jockeyWeightKg: number | null;
  horseWeightKg: number | null;
  horseWeightDiffKg: number | null;
  oddsWin: number | null;
  popularity: number | null;
  finishPosition: number | null;
  finishTimeSec: number | null;
  marginSec: number | null;
  cornerPositions: string | null;
  agari3fSec: number | null;
}

export interface ParsedRaceResult {
  meta: ParsedRaceMeta;
  horses: ParsedHorseResult[];
}

const VENUE_NAMES: Record<string, string> = {
  "01": "札幌",
  "02": "函館",
  "03": "福島",
  "04": "新潟",
  "05": "東京",
  "06": "中山",
  "07": "中京",
  "08": "京都",
  "09": "阪神",
  "10": "小倉",
};

// 着差 (馬身) → 秒への概算変換。netkeibaの結果ページは2着以下の正確な着差タイムを
// 公表していないため、相対的な目安として使う近似値。厳密な数値ではない。
const MARGIN_TO_SECONDS: Record<string, number> = {
  "同着": 0,
  "ハナ": 0.0,
  "アタマ": 0.1,
  "クビ": 0.2,
  "1/2": 0.3,
  "3/4": 0.4,
  "1": 0.5,
  "1.1/4": 0.6,
  "1.1/2": 0.7,
  "1.3/4": 0.8,
  "2": 0.9,
  "2.1/2": 1.1,
  "3": 1.3,
  "3.1/2": 1.5,
  "4": 1.7,
  "5": 2.0,
  "6": 2.4,
  "7": 2.8,
  "8": 3.2,
  "10": 4.0,
  "大差": 5.0,
};

function toHalfWidth(text: string): string {
  return text.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

function parseFinishTimeSec(text: string): number | null {
  const match = text.trim().match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return minutes * 60 + seconds;
}

function parseMarginSec(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return 0; // 1着は着差なし
  return MARGIN_TO_SECONDS[trimmed] ?? null;
}

function parseWeight(text: string): { weightKg: number | null; diffKg: number | null } {
  const match = text.trim().match(/^(\d+)\s*(?:\(([+-]?\d+)\))?/);
  if (!match) return { weightKg: null, diffKg: null };
  return {
    weightKg: Number(match[1]),
    diffKg: match[2] !== undefined ? Number(match[2]) : null,
  };
}

function parseRaceMeta(
  $: cheerio.CheerioAPI,
  html: string,
  raceId: string,
): ParsedRaceMeta {
  const keibajoCode = raceId.slice(4, 6);
  const raceNumberFromId = Number(raceId.slice(10, 12));

  // ページ内には他開催日への切り替えリンクにも kaisai_date が含まれるため、
  // 払戻リンク (このレース自体の開催日を指す) から限定して取得する。
  const raceDateMatch = $(".Refundlink a")
    .attr("href")
    ?.match(/kaisai_date=(\d{4})(\d{2})(\d{2})/);
  const raceDate = raceDateMatch
    ? `${raceDateMatch[1]}-${raceDateMatch[2]}-${raceDateMatch[3]}`
    : "";

  const raceName = $("h1.RaceName").first().text().replace(/\s+/g, " ").trim() || null;

  const raceData01 = $(".RaceData01").first().text().replace(/\s+/g, " ").trim();
  const trackTypeChar = raceData01.match(/(芝|ダ|障)\d/)?.[1] ?? null;
  const trackType: TrackType | null =
    trackTypeChar === "芝" ? "芝" : trackTypeChar === "ダ" ? "ダート" : trackTypeChar === "障" ? "障害" : null;
  const distanceM = Number(raceData01.match(/(\d+)m/)?.[1]) || null;
  const weather = raceData01.match(/天候:(\S)/)?.[1] ?? null;
  const trackCondition = (raceData01.match(/馬場:(良|稍重|重|不良)/)?.[1] ?? null) as TrackCondition | null;

  const raceData02Spans = $(".RaceData02")
    .first()
    .find("span")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((text) => text.length > 0);
  const entryCount = Number(
    raceData02Spans.find((text) => /\d+頭/.test(text))?.match(/(\d+)頭/)?.[1],
  ) || null;
  const keibajoName = VENUE_NAMES[keibajoCode] ?? null;
  const raceClass =
    raceData02Spans.filter(
      (text) =>
        !/回$/.test(text) &&
        !/日目$/.test(text) &&
        !/頭$/.test(text) &&
        !/^本賞金/.test(text) &&
        text !== keibajoName,
    ).join(" ") || null;

  const gradeMatch = html.match(/Icon_GradeType(\d)/);
  const grade = gradeMatch ? `G${gradeMatch[1]}` : null;

  const paceMarkText = $(".RapPace_Title span").first().text().trim();
  const paceMark: PaceMark | null =
    paceMarkText === "S" || paceMarkText === "M" || paceMarkText === "H" ? paceMarkText : null;

  return {
    raceDate,
    keibajoCode,
    keibajoName,
    raceNumber: raceNumberFromId || null,
    raceName,
    grade,
    raceClass,
    trackType,
    distanceM,
    trackCondition,
    weather,
    entryCount,
    paceMark,
  };
}

function parseHorseRow($: cheerio.CheerioAPI, row: Element): ParsedHorseResult | null {
  const $row = $(row);

  const horseLink = $row.find('a[href*="/horse/"]').first();
  const horseIdMatch = horseLink.attr("href")?.match(/\/horse\/(\d{10})/);
  if (!horseIdMatch) return null; // 馬IDが取れない行 (広告行等) はスキップ

  const timeCells = $row.find("td.Time");
  const finishTimeText = timeCells.eq(0).find(".RaceTime").text();
  const marginText = timeCells.eq(1).find(".RaceTime").text();
  const agariText = timeCells.eq(2).text();

  const weightText = $row.find("td.Weight").text();
  const { weightKg, diffKg } = parseWeight(weightText);

  const finishPositionText = toHalfWidth($row.find("td.Result_Num .Rank").text().trim());
  const finishPosition = /^\d+$/.test(finishPositionText) ? Number(finishPositionText) : null;

  const postPositionText = $row.find('td.Num[class*="Waku"] div').first().text().trim();
  const horseNumberText = $row.find("td.Num.Txt_C div").first().text().trim();

  // 単勝オッズのspanは上位人気馬のみ.Odds_Ninki等の装飾クラスが付き、それ以外は無クラスのため
  // クラス名ではなく列位置 (td.Oddsの2番目 = 単勝オッズ) で拾う。
  const oddsCells = $row.find("td.Odds");
  const oddsWinText = oddsCells.eq(1).find("span").first().text().trim();

  return {
    netkeibaHorseId: horseIdMatch[1],
    horseName: $row.find(".HorseNameSpan").first().text().trim(),
    postPosition: postPositionText ? Number(postPositionText) : null,
    horseNumber: horseNumberText ? Number(horseNumberText) : null,
    // 先頭の▲△☆★は減量騎手を示すnetkeiba独自の記号のため、名前としては除去する。
    jockeyName:
      $row
        .find("td.Jockey .JockeyNameSpan")
        .text()
        .trim()
        .replace(/^[▲△☆★]/, "") || null,
    jockeyWeightKg: Number($row.find("td.Jockey_Info .JockeyWeight").text().trim()) || null,
    horseWeightKg: weightKg,
    horseWeightDiffKg: diffKg,
    oddsWin: Number(oddsWinText) || null,
    popularity: Number($row.find(".OddsPeople").text().trim()) || null,
    finishPosition,
    finishTimeSec: parseFinishTimeSec(finishTimeText),
    marginSec: parseMarginSec(marginText),
    cornerPositions: $row.find("td.PassageRate").text().trim() || null,
    agari3fSec: Number(agariText.trim()) || null,
  };
}

export function parseRaceResultHtml(html: string, raceId: string): ParsedRaceResult | null {
  const $ = cheerio.load(html);
  const rows = $("table.RaceTable01 tbody tr").toArray();
  if (rows.length === 0) return null; // レース未確定・ページ構造変化等

  const horses = rows
    .map((row) => parseHorseRow($, row))
    .filter((horse): horse is ParsedHorseResult => horse !== null);

  return {
    meta: parseRaceMeta($, html, raceId),
    horses,
  };
}
