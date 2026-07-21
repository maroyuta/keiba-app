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

export function describeLength(text: string): string {
  return `${weightedLength(text)}/280 weighted(全角${Math.ceil(weightedLength(text) / 2)}字相当)`;
}
