import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { Sex, TrackType } from "@/lib/supabase/database.types";

// race.netkeiba.com/race/shutuba.html?race_id=XXXXXXXXXXXX の実HTML構造 (2026-07時点) を
// 元にしたパーサー。result.htmlと違い「レース前」のページのため、枠番・馬番・斤量・馬体重は
// 枠順確定(ユーザーの実感では金・土、レースにより前後する)が終わるまで空欄になる(実データで確認済み)。空欄の場合は
// null を返すので、呼び出し側は「抽選待ち」として扱い、race_entriesへの書き込みを見送ること。
// 天候・馬場状態はこのページには載らない。
// **オッズ・人気は各馬の行に`<span id="odds-1_N">`/`<span id="ninki-1_N">`として構造自体は
// 常に存在するが、発売開始前は"---.-"/"**"のプレースホルダーのままで、発売開始後(実感では
// 枠順確定と近いタイミング)に実際の数値へ置き換わる(2026-07-14、実HTML確認済み)。
// このため単発の枠順取得と違い、オッズは同じraceIdに対して繰り返し取得し直す運用を想定する。

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

export interface ParsedShutubaMeta {
  raceDate: string; // YYYY-MM-DD
  keibajoCode: string; // '01'-'10'
  keibajoName: string | null;
  kaiji: number | null; // race_id(=jv_race_key)の6-8桁目から導出
  nichiji: number | null; // race_id の8-10桁目から導出
  raceNumber: number | null;
  raceName: string | null;
  grade: string | null;
  raceClass: string | null;
  trackType: TrackType | null;
  distanceM: number | null;
  entryCount: number | null;
  postTime: string | null; // "HH:MM:00"
}

export interface ParsedShutubaHorse {
  netkeibaHorseId: string; // horses.jv_horse_idと同一の想定 (既存スクレイパーと同じ前提)
  horseName: string;
  postPosition: number | null; // 枠番。抽選前はnull
  horseNumber: number | null; // 馬番。抽選前はnull
  sex: Sex | null;
  jockeyName: string | null;
  jockeyWeightKg: number | null;
  trainerName: string | null;
  trainerAffiliation: string | null; // "美浦" | "栗東"
  horseWeightKg: number | null;
  horseWeightDiffKg: number | null;
  oddsWin: number | null; // 単勝オッズ。発売開始前はnull
  popularity: number | null; // 人気順位。発売開始前はnull
}

export interface ParsedShutuba {
  meta: ParsedShutubaMeta;
  horses: ParsedShutubaHorse[];
}

function parseWeight(text: string): { weightKg: number | null; diffKg: number | null } {
  const match = text.trim().match(/^(\d+)\s*(?:\(([+-]?\d+)\))?/);
  if (!match) return { weightKg: null, diffKg: null };
  return {
    weightKg: Number(match[1]),
    diffKg: match[2] !== undefined ? Number(match[2]) : null,
  };
}

function parseMeta($: cheerio.CheerioAPI, html: string, raceId: string): ParsedShutubaMeta {
  const keibajoCode = raceId.slice(4, 6);
  const kaiji = Number(raceId.slice(6, 8)) || null;
  const nichiji = Number(raceId.slice(8, 10)) || null;
  const raceNumber = Number(raceId.slice(10, 12)) || null;
  const keibajoName = VENUE_NAMES[keibajoCode] ?? null;

  // shutuba.htmlには結果ページの.Refundlinkのような開催日リンクが無いため、<title>から拾う
  // (例: "小倉記念(G3) 出馬表 | 2026年7月19日 小倉11R レース情報(JRA) - netkeiba")。
  const titleDateMatch = $("title").text().match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const raceDate = titleDateMatch
    ? `${titleDateMatch[1]}-${titleDateMatch[2].padStart(2, "0")}-${titleDateMatch[3].padStart(2, "0")}`
    : "";

  const raceName = $("h1.RaceName").first().clone().children().remove().end().text().trim() || null;

  const raceData01 = $(".RaceData01").first().text().replace(/\s+/g, " ").trim();
  const trackTypeChar = raceData01.match(/(芝|ダ|障)\d/)?.[1] ?? null;
  const trackType: TrackType | null =
    trackTypeChar === "芝" ? "芝" : trackTypeChar === "ダ" ? "ダート" : trackTypeChar === "障" ? "障害" : null;
  const distanceM = Number(raceData01.match(/(\d+)m/)?.[1]) || null;
  const postTimeMatch = raceData01.match(/^(\d{1,2}):(\d{2})発走/);
  const postTime = postTimeMatch ? `${postTimeMatch[1].padStart(2, "0")}:${postTimeMatch[2]}:00` : null;

  const raceData02Spans = $(".RaceData02")
    .first()
    .find("span")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((text) => text.length > 0);
  const entryCount = Number(
    raceData02Spans.find((text) => /\d+頭/.test(text))?.match(/(\d+)頭/)?.[1],
  ) || null;
  const raceClass =
    raceData02Spans.filter(
      (text) =>
        !/回$/.test(text) &&
        !/日目$/.test(text) &&
        !/頭$/.test(text) &&
        !/^本賞金/.test(text) &&
        text !== keibajoName,
    ).join(" ") || null;

  // Icon_GradeType1〜3がG1〜G3。ただしIcon_GradeType13/16/17/18等、末尾に2桁以上続く
  // クラス名はグレードとは無関係の別種アイコン(混合/国際等)のため、1桁のみで後ろに
  // 数字が続かないものだけを対象にする(2026-07-13、末尾数字が誤ってG1判定されるバグを修正)。
  const gradeMatch = html.match(/Icon_GradeType([1-3])(?!\d)/);
  const grade = gradeMatch ? `G${gradeMatch[1]}` : null;

  return {
    raceDate,
    keibajoCode,
    keibajoName,
    kaiji,
    nichiji,
    raceNumber,
    raceName,
    grade,
    raceClass,
    trackType,
    distanceM,
    entryCount,
    postTime,
  };
}

function parseHorseRow($: cheerio.CheerioAPI, row: Element): ParsedShutubaHorse | null {
  const $row = $(row);

  const horseLink = $row.find('a[href*="/horse/"]').first();
  const horseIdMatch = horseLink.attr("href")?.match(/\/horse\/(\d{10})/);
  if (!horseIdMatch) return null; // 馬IDが取れない行はスキップ

  const postPositionText = $row.find('td[class^="Waku"] span').first().text().trim();
  const horseNumberText = $row.find('td[class^="Umaban"]').first().text().trim();

  const bareiText = $row.find("td.Barei").first().text().trim();
  const sexChar = bareiText.charAt(0);
  const sex: Sex | null = sexChar === "牡" || sexChar === "牝" || sexChar === "セ" ? sexChar : null;

  // 斤量セルはtd.Bareiの直後にあるが、抽選前/後でclassが変わらず専用クラスが無いため、
  // 位置(次のtd)で拾う。
  const jockeyWeightText = $row.find("td.Barei").first().next().text().trim();

  const { weightKg, diffKg } = parseWeight($row.find("td.Weight").text());

  // オッズ・人気は`id="odds-1_<馬番>"`/`id="ninki-1_<馬番>"`のspanで持つ。発売開始前は
  // "---.-"/"**"のプレースホルダーなので、数値化できない場合はnullとして扱う。
  const oddsText = $row.find('span[id^="odds-"]').first().text().trim();
  const popularityText = $row.find('span[id^="ninki-"]').first().text().trim();
  const oddsWin = /^\d+(\.\d+)?$/.test(oddsText) ? Number(oddsText) : null;
  const popularity = /^\d+$/.test(popularityText) ? Number(popularityText) : null;

  return {
    netkeibaHorseId: horseIdMatch[1],
    horseName: $row.find(".HorseName").first().text().trim(),
    postPosition: postPositionText ? Number(postPositionText) : null,
    horseNumber: horseNumberText ? Number(horseNumberText) : null,
    sex,
    jockeyName:
      $row
        .find("td.Jockey a")
        .first()
        .text()
        .trim()
        .replace(/^[▲△☆★]/, "") || null,
    jockeyWeightKg: Number(jockeyWeightText) || null,
    trainerName: $row.find("td.Trainer a").first().text().trim() || null,
    trainerAffiliation: $row.find("td.Trainer .Label2").first().text().trim() || null,
    horseWeightKg: weightKg,
    horseWeightDiffKg: diffKg,
    oddsWin,
    popularity,
  };
}

export function parseShutubaHtml(html: string, raceId: string): ParsedShutuba | null {
  const $ = cheerio.load(html);
  const rows = $("table.Shutuba_Table tr.HorseList").toArray();
  if (rows.length === 0) return null; // ページ構造変化・非公開等

  const horses = rows
    .map((row) => parseHorseRow($, row))
    .filter((horse): horse is ParsedShutubaHorse => horse !== null);

  // netkeibaのshutuba.htmlは同じ馬IDのHorseList行が稀に重複して載ることがある
  // (実データで確認: 馬名・馬番が空の"幽霊行"が1頭分紛れ込むケース、2026-07-18)。
  // 重複IDは名前が埋まっている方(実データ)を優先して1件に潰す。ensureHorsesの
  // upsertは同一バッチ内に同じ conflict key が複数あるとPostgresが
  // "ON CONFLICT DO UPDATE command cannot affect row a second time" で
  // 丸ごと失敗するため、ここで防ぐ必要がある。
  const dedupedById = new Map<string, ParsedShutubaHorse>();
  for (const horse of horses) {
    const existing = dedupedById.get(horse.netkeibaHorseId);
    if (!existing || (!existing.horseName && horse.horseName)) {
      dedupedById.set(horse.netkeibaHorseId, horse);
    }
  }

  return {
    meta: parseMeta($, html, raceId),
    horses: [...dedupedById.values()],
  };
}
