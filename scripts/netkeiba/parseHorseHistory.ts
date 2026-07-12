import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { TrackCondition, TrackType } from "@/lib/supabase/database.types";

// db.netkeiba.com/horse/result/{netkeiba馬ID}/ の実HTML構造 (2026-07時点) を元にした
// パーサー。race.netkeiba.com/race/result.htmlとは別ドメイン・別マークアップ・別文字コード
// (charset=euc-jp、httpClient.tsのfetchNetkeibaHtml(url, "euc-jp")で取得する前提)。
//
// この馬個別ページは「1馬の全レース履歴が1ページに収まっている」ため、
// 自前のracesテーブルの範囲(JV-Linkが同期した期間)を超えて過去走を遡れる利点がある。
// レース名セルのリンク(https://db.netkeiba.com/race/{race_id}/)からrace_idが直接取れ、
// このrace_idはjv_race_keyと同一の12桁フォーマット(実データで確認済み、AGENTS.md参照)。

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

export interface ParsedHorseHistoryEntry {
  raceId: string; // 12桁、races.jv_race_keyと同一フォーマット
  raceDate: string; // YYYY-MM-DD
  keibajoCode: string;
  keibajoName: string | null;
  raceNumber: number | null;
  raceName: string | null;
  trackType: TrackType | null;
  distanceM: number | null;
  trackCondition: TrackCondition | null;
  weather: string | null;
  entryCount: number | null;
  postPosition: number | null;
  horseNumber: number | null;
  jockeyName: string | null;
  jockeyWeightKg: number | null;
  oddsWin: number | null;
  popularity: number | null;
  finishPosition: number | null;
  finishTimeSec: number | null;
  marginSec: number | null;
  cornerPositions: string | null;
  agari3fSec: number | null;
  horseWeightKg: number | null;
  horseWeightDiffKg: number | null;
}

function parseFinishTimeSec(text: string): number | null {
  const match = text.trim().match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseWeight(text: string): { weightKg: number | null; diffKg: number | null } {
  const match = text.trim().match(/^(\d+)\s*(?:\(([+-]?\d+)\))?/);
  if (!match) return { weightKg: null, diffKg: null };
  return {
    weightKg: Number(match[1]),
    diffKg: match[2] !== undefined ? Number(match[2]) : null,
  };
}

// netkeiba側の馬個別ページでは、一部の古いレース行で馬場状態が「稍重」ではなく
// 「稍」と省略表記されているケースが実データで見つかった(2025-08-31、2歳未勝利)。
// DBのcheck constraint(良/稍重/重/不良)に合わせて正規化する。
function normalizeTrackCondition(text: string): TrackCondition | null {
  if (text === "稍") return "稍重";
  if (text === "良" || text === "稍重" || text === "重" || text === "不良") {
    return text as TrackCondition;
  }
  return null;
}

function parseDistance(text: string): { trackType: TrackType | null; distanceM: number | null } {
  const match = text.trim().match(/^(芝|ダ|障)(\d+)/);
  if (!match) return { trackType: null, distanceM: null };
  const trackType: TrackType | null =
    match[1] === "芝" ? "芝" : match[1] === "ダ" ? "ダート" : match[1] === "障" ? "障害" : null;
  return { trackType, distanceM: Number(match[2]) };
}

// このページの見出し行(<thead>)から列名->列indexのマップを作る。列の並びは基本的に
// 固定だが、netkeiba側の仕様変更やプレミアム会員限定列の有無で崩れる可能性があるため、
// ハードコードした位置ではなく都度この見出しを見て解決する(壊れにくくするため)。
function buildHeaderIndex($: cheerio.CheerioAPI): Map<string, number> {
  const index = new Map<string, number>();
  $("table.db_h_race_results thead th").each((i, el) => {
    const text = $(el).text().replace(/\s+/g, "");
    if (text && !index.has(text)) {
      index.set(text, i);
    }
  });
  return index;
}

function cellText($: cheerio.CheerioAPI, tds: Element[], headerIndex: Map<string, number>, name: string): string {
  const idx = headerIndex.get(name);
  if (idx === undefined || !tds[idx]) return "";
  return $(tds[idx]).text().replace(/\s+/g, "").trim();
}

function parseHistoryRow(
  $: cheerio.CheerioAPI,
  row: Element,
  headerIndex: Map<string, number>,
): ParsedHorseHistoryEntry | null {
  const $row = $(row);
  const tds = $row.find("> td").toArray();
  if (tds.length === 0) return null;

  const raceNameIdx = headerIndex.get("レース名");
  const raceLink = raceNameIdx !== undefined ? $(tds[raceNameIdx]).find("a").first() : null;
  const raceIdMatch = raceLink?.attr("href")?.match(/\/race\/(\d{12})\/?$/);
  if (!raceIdMatch) return null; // レース名リンクが取れない行(集計行等)はスキップ

  const raceId = raceIdMatch[1];
  const keibajoCode = raceId.slice(4, 6);
  const raceNumber = Number(raceId.slice(10, 12)) || null;

  const dateText = cellText($, tds, headerIndex, "日付"); // "2026/01/31"
  const dateMatch = dateText.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  const raceDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : "";
  if (!raceDate) return null;

  const { trackType, distanceM } = parseDistance(cellText($, tds, headerIndex, "距離"));
  const { weightKg, diffKg } = parseWeight(cellText($, tds, headerIndex, "馬体重"));

  const finishPositionText = cellText($, tds, headerIndex, "着順");
  const finishPosition = /^\d+$/.test(finishPositionText) ? Number(finishPositionText) : null;

  const marginText = cellText($, tds, headerIndex, "着差");
  const marginSec = marginText !== "" && !Number.isNaN(Number(marginText)) ? Number(marginText) : null;

  return {
    raceId,
    raceDate,
    keibajoCode,
    keibajoName: VENUE_NAMES[keibajoCode] ?? null,
    raceNumber,
    raceName: raceLink?.attr("title")?.trim() || raceLink?.text().trim() || null,
    trackType,
    distanceM,
    trackCondition: normalizeTrackCondition(cellText($, tds, headerIndex, "馬場")),
    weather: cellText($, tds, headerIndex, "天気") || null,
    entryCount: Number(cellText($, tds, headerIndex, "頭数")) || null,
    postPosition: Number(cellText($, tds, headerIndex, "枠番")) || null,
    horseNumber: Number(cellText($, tds, headerIndex, "馬番")) || null,
    jockeyName: cellText($, tds, headerIndex, "騎手") || null,
    jockeyWeightKg: Number(cellText($, tds, headerIndex, "斤量")) || null,
    oddsWin: Number(cellText($, tds, headerIndex, "オッズ")) || null,
    popularity: Number(cellText($, tds, headerIndex, "人気")) || null,
    finishPosition,
    finishTimeSec: parseFinishTimeSec(cellText($, tds, headerIndex, "タイム")),
    marginSec,
    cornerPositions: cellText($, tds, headerIndex, "通過") || null,
    agari3fSec: Number(cellText($, tds, headerIndex, "上り")) || null,
    horseWeightKg: weightKg,
    horseWeightDiffKg: diffKg,
  };
}

export function parseHorseHistoryHtml(html: string): ParsedHorseHistoryEntry[] {
  const $ = cheerio.load(html);
  const headerIndex = buildHeaderIndex($);
  if (headerIndex.size === 0) return []; // ページ構造変化・非公開ページ等

  const rows = $("table.db_h_race_results tbody tr").toArray();
  return rows
    .map((row) => parseHistoryRow($, row, headerIndex))
    .filter((entry): entry is ParsedHorseHistoryEntry => entry !== null);
}
