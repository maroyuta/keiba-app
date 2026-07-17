import * as cheerio from "cheerio";

export interface ParsedPedigree {
  sireName: string;
  damName: string;
  damSireName: string;
}

// netkeibaの馬個別ページは血統表をJSでAJAX取得している(SSR HTMLには含まれない)ため、
// 裏で叩いているエンドポイントを直接呼ぶ。素直なHTTP GETで返る2代血統(父/母/母父/母母)の
// 固定フォーマットの表で、AGENTS.md「血統データソースの確定」節に記載の
// JBIS/studbook.jp優先方針とは別に、この2代分の簡易参照(horses.sire_name等)だけは
// netkeiba経由で無料・即座に取得できる。
export function buildPedigreeAjaxUrl(jvHorseId: string): string {
  return `https://db.netkeiba.com/horse/ajax_horse_pedigree.html?input=UTF-8&output=json&id=${jvHorseId}`;
}

// レスポンスは {"status":"OK","data":"<div>...<table class=\"blood_table\">...</table></div>"}
// というJSON。dataの中のblood_tableは常に6頭分(父/父父/父母/母/母父/母母)を
// ドキュメント順で持つ固定フォーマット(実データで確認済み、2026-07-16)。
export function parsePedigreeJson(json: string): ParsedPedigree | null {
  let parsed: { status?: string; data?: string };
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (parsed.status !== "OK" || !parsed.data) return null;

  const $ = cheerio.load(parsed.data);
  const names = $("table.blood_table a span")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((name) => name.length > 0);

  // [父, 父父, 父母, 母, 母父, 母母] の6頭固定
  if (names.length < 5) return null;

  return {
    sireName: names[0],
    damName: names[3],
    damSireName: names[4],
  };
}
