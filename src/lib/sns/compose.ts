import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { formatDateLabel } from "./cards";
import { fitsInTweet, weightedLength } from "./xClient";

// 投稿本文の組み立て。140字(全角)に収まるまで狙い行を1つずつ削って調整する。
// 誇大表現を避ける方針(docs/twitter-strategy.md §4)に沿い、断定語は使わない。

type Db = SupabaseClient<Database>;

const RANK_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

export type PreviewData = {
  date: string;
  diagnosedCount: number;
  buys: {
    keibajo_name: string | null;
    race_number: number;
    honmei_horse_number: number | null;
    aite_horse_number: number | null;
    aite_horse_number_2: number | null;
    race_rank: string | null;
  }[];
  venues: string[];
  sCount: number;
  aCount: number;
};

export async function loadPreviewData(supabase: Db, date: string): Promise<PreviewData> {
  const { data } = await supabase
    .from("races")
    .select("keibajo_name, race_number, race_rank, honmei_horse_number, aite_horse_number, aite_horse_number_2")
    .eq("race_date", date)
    .not("race_rank", "is", null);

  const diagnosed = data ?? [];
  const buys = diagnosed
    .filter((r) => r.honmei_horse_number !== null)
    .sort(
      (a, b) =>
        (RANK_ORDER[a.race_rank ?? ""] ?? 9) - (RANK_ORDER[b.race_rank ?? ""] ?? 9) ||
        a.race_number - b.race_number
    );

  return {
    date,
    diagnosedCount: diagnosed.length,
    buys,
    venues: [...new Set(diagnosed.map((r) => r.keibajo_name).filter((v): v is string => !!v))],
    sCount: diagnosed.filter((r) => r.race_rank === "S").length,
    aCount: diagnosed.filter((r) => r.race_rank === "A").length,
  };
}

function buyLabel(b: PreviewData["buys"][number]): string {
  return (
    `${b.keibajo_name}${b.race_number}R ◎${b.honmei_horse_number}` +
    (b.aite_horse_number ? `→${b.aite_horse_number}` : "") +
    (b.aite_horse_number_2 ? `・${b.aite_horse_number_2}` : "")
  );
}

// 狙い行をmax件から1件ずつ減らし、140字に収まる最大の件数で確定する
function fitBuyLines(build: (lines: string) => string, buys: PreviewData["buys"]): string {
  for (let n = Math.min(3, buys.length); n >= 1; n--) {
    const shown = buys.slice(0, n).map(buyLabel).join(" / ");
    const rest = buys.length > n ? ` ほか${buys.length - n}R` : "";
    const text = build(shown + rest);
    if (fitsInTweet(text)) return text;
  }
  return build(`買い${buys.length}R(画像参照)`);
}

// 前日夜ポスト(金・土 22:30)
export function composeEveningPreview(d: PreviewData): string {
  const label = formatDateLabel(d.date);
  return fitBuyLines(
    (lines) =>
      `【${label}の診断】\n` +
      `AIが${d.venues.join("・")}の${d.diagnosedCount}Rを事前診断、買いは${d.buys.length}R。\n` +
      `狙い: ${lines}\n` +
      `全レースは画像で。結果は外れも全部報告します。\n#競馬予想`,
    d.buys
  );
}

// 当日朝ポスト(土・日 7:30)
export function composeMorningPreview(d: PreviewData): string {
  const label = formatDateLabel(d.date);
  return fitBuyLines(
    (lines) =>
      `【きょうの狙い】${label}\n` +
      `${lines}\n` +
      `発走前に全公開。的中も外れも夕方に報告します。\n#競馬予想`,
    d.buys
  );
}

export type ResultsData = {
  date: string;
  bets: number;
  hits: number;
  stakeYen: number;
  returnYen: number;
  topHits: { keibajo_name: string | null; race_number: number; return_yen: number | null }[];
};

export async function loadResultsData(supabase: Db, date: string): Promise<ResultsData> {
  const { data } = await supabase
    .from("race_recommendation_results")
    .select(
      "is_hit, stake_yen, return_yen, races!inner(race_date, keibajo_name, race_number)"
    )
    .not("computed_at", "is", null)
    .gte("races.race_date", date)
    .lte("races.race_date", date)
    .returns<
      {
        is_hit: boolean | null;
        stake_yen: number | null;
        return_yen: number | null;
        races: { keibajo_name: string | null; race_number: number };
      }[]
    >();

  const rows = data ?? [];
  const hits = rows.filter((r) => r.is_hit);
  return {
    date,
    bets: rows.length,
    hits: hits.length,
    stakeYen: rows.reduce((s, r) => s + (r.stake_yen ?? 0), 0),
    returnYen: rows.reduce((s, r) => s + (r.return_yen ?? 0), 0),
    topHits: hits
      .sort((a, b) => (b.return_yen ?? 0) - (a.return_yen ?? 0))
      .slice(0, 2)
      .map((r) => ({
        keibajo_name: r.races.keibajo_name,
        race_number: r.races.race_number,
        return_yen: r.return_yen,
      })),
  };
}

// 結果ポスト(土・日 17:30、朝の予想を引用RT)
export function composeResults(d: ResultsData): string {
  const label = formatDateLabel(d.date);
  const hitRate = d.bets > 0 ? ((d.hits / d.bets) * 100).toFixed(1) : "0.0";
  const roi = d.stakeYen > 0 ? ((d.returnYen / d.stakeYen) * 100).toFixed(1) : "0.0";
  const head =
    `【結果】${label}\n` +
    `購入${d.bets}件・的中${d.hits}件(${hitRate}%)\n` +
    `投資${d.stakeYen.toLocaleString()}円→払戻${d.returnYen.toLocaleString()}円(回収率${roi}%)\n`;
  const tail = `外れも全部残します。\n#競馬予想`;

  // 的中の内訳は入るだけ載せる(的中ゼロの日も同じ体裁で正直に出す)
  if (d.hits === 0) {
    return `${head}きょうは的中なし。\n${tail}`;
  }
  for (let n = d.topHits.length; n >= 1; n--) {
    const lines = d.topHits
      .slice(0, n)
      .map(
        (h) => `的中: ${h.keibajo_name}${h.race_number}R (${(h.return_yen ?? 0).toLocaleString()}円)`
      )
      .join("\n");
    const text = `${head}${lines}\n${tail}`;
    if (fitsInTweet(text)) return text;
  }
  return `${head}${tail}`;
}

export type DangerFavoriteData = {
  raceId: string;
  race_date: string;
  keibajo_name: string | null;
  race_number: number;
  race_name: string | null;
  race_class: string | null;
  post_time: string | null;
  horse_number: number;
  post_position: number;
  horse_name: string;
  expected_popularity: number;
  odds_win: number | null;
  horse_rank: string | null;
  horse_rank_comment: string;
} | null;

// 発走前に上位人気馬(1〜5番人気)の中から「危険」と明言された馬を1頭だけ選ぶ。
// horse_rank_commentへの「危険」の書き込みはprompts.ts §「危険な人気馬」の指示に依る
// (LLMが該当ありと判断した場合のみ書かれる、機械的スコアリングではない自由記述)。
// 1日1投稿の想定のため、該当が複数レースにまたがる場合は最も人気(番号が若い=人気が高い)な
// 馬を優先する(見出し力が強く、外れた場合の検証価値も高いため)。同着はpost_timeが早い方。
export async function loadDangerFavoriteData(supabase: Db, date: string): Promise<DangerFavoriteData> {
  const { data } = await supabase
    .from("race_entries")
    .select(
      "horse_number, post_position, expected_popularity, odds_win, horse_rank, horse_rank_comment, " +
        "horses(horse_name), races!inner(id, race_date, keibajo_name, race_number, race_name, race_class, post_time)"
    )
    .eq("races.race_date", date)
    .not("expected_popularity", "is", null)
    .lte("expected_popularity", 5)
    .like("horse_rank_comment", "%危険%")
    .returns<
      {
        horse_number: number;
        post_position: number;
        expected_popularity: number | null;
        odds_win: number | null;
        horse_rank: string | null;
        horse_rank_comment: string | null;
        horses: { horse_name: string } | null;
        races: {
          id: string;
          race_date: string;
          keibajo_name: string | null;
          race_number: number;
          race_name: string | null;
          race_class: string | null;
          post_time: string | null;
        };
      }[]
    >();

  const rows = data ?? [];
  if (rows.length === 0) return null;

  rows.sort(
    (a, b) =>
      (a.expected_popularity ?? 9) - (b.expected_popularity ?? 9) ||
      (a.races.post_time ?? "").localeCompare(b.races.post_time ?? "")
  );
  const r = rows[0];
  return {
    raceId: r.races.id,
    race_date: r.races.race_date,
    keibajo_name: r.races.keibajo_name,
    race_number: r.races.race_number,
    race_name: r.races.race_name,
    race_class: r.races.race_class,
    post_time: r.races.post_time,
    horse_number: r.horse_number,
    post_position: r.post_position,
    horse_name: r.horses?.horse_name ?? "—",
    expected_popularity: r.expected_popularity ?? 0,
    odds_win: r.odds_win,
    horse_rank: r.horse_rank,
    horse_rank_comment: r.horse_rank_comment ?? "",
  };
}

// 発走前ポスト(危険な人気馬)。3案のうち①を採用(2026-08-02、ユーザー判断)。
// 受け身の実況より「発走前の具体的・検証可能な逆張り投稿」の方が拡散・信頼構築の両面で強いため。
// 断定表現は避け、根拠は必ずhorse_rank_commentの実文を引用する(でっち上げ防止・twitter-strategy.md §4)。
export function composeDangerFavorite(d: NonNullable<DangerFavoriteData>): string {
  const raceTitle = d.race_name || d.race_class || `${d.race_number}R`;
  const timeLabel = d.post_time ? d.post_time.slice(0, 5) : "";
  const oddsLabel = d.odds_win ? `${d.odds_win.toFixed(1)}倍` : "";
  const head =
    `⚠️危険な人気馬\n` +
    `${d.keibajo_name ?? ""}${d.race_number}R ${raceTitle}(${timeLabel}発走)\n` +
    `${d.horse_number}番 ${d.horse_name}(${d.expected_popularity}人気${oddsLabel ? " " + oddsLabel : ""})\n`;
  const tail = `\n結果は的中も外れも夕方に報告します。\n#競馬予想`;

  for (let max = d.horse_rank_comment.length; max >= 20; max -= 10) {
    const reason = truncateReason(d.horse_rank_comment, max);
    const text = `${head}${reason}${tail}`;
    if (fitsInTweet(text)) return text;
  }
  return `${head}${tail}`;
}

// horse_rank_commentはLLMの自由記述のため、「⚠️」や「危険な人気馬:」等、画像・本文側で
// 既に見出しとして表示済みの接頭辞が重複して入っていることがある。表示直前に剥がす。
function stripDangerPrefix(text: string): string {
  return text.replace(/^(⚠️\s*)?危険な人気馬[:：]?\s*/, "").replace(/^⚠️\s*/, "").trim();
}

function truncateReason(text: string, max: number): string {
  const stripped = stripDangerPrefix(text);
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}

export function describeLength(text: string): string {
  return `${weightedLength(text)}/280 weighted(全角${Math.ceil(weightedLength(text) / 2)}字相当)`;
}
