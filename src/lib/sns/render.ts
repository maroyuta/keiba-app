import { ImageResponse } from "next/og";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  DigestCard,
  RaceCard,
  ResultsCard,
  formatDateLabel,
  type CardEntry,
  type CardRace,
  type DigestRow,
  type ResultRow,
  type ResultsSummary,
} from "./cards";
import { buildFonts } from "./font";
import { cardSize, type CardFormat } from "./theme";

// カード画像のデータ取得+レンダリング。API Route(/api/sns/*)と
// ヘッドレスなバッチ(scripts/sns/*)の両方から同じコードを使うためlibに置く。
// dev serverに依存しないので、launchdからの無人実行でも動く。

type Db = SupabaseClient<Database>;

// /dashboard(page.tsx)のLIVE_TRACKING_START_DATEと同じ。実運用の累計はこの日以降のみ。
export const LIVE_TRACKING_START_DATE = "2026-07-18";

export type ResultJoinRow = {
  is_hit: boolean | null;
  stake_yen: number | null;
  return_yen: number | null;
  race_rank: string | null;
  races: {
    race_date: string;
    keibajo_name: string | null;
    race_number: number;
    race_name: string | null;
    race_class: string | null;
  };
};

const RESULT_SELECT =
  "is_hit, stake_yen, return_yen, race_rank, races!inner(race_date, keibajo_name, race_number, race_name, race_class)";

export function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function toPng(element: React.ReactElement, format: CardFormat, dynamicText: string) {
  const fonts = await buildFonts(dynamicText);
  return new ImageResponse(element, { ...cardSize(format), fonts });
}

export async function renderRaceCard(
  supabase: Db,
  raceId: string,
  format: CardFormat
): Promise<ImageResponse | null> {
  const { data: race } = await supabase.from("races").select("*").eq("id", raceId).single();
  if (!race) return null;

  const { data: entries } = await supabase
    .from("race_entries")
    .select("*, horses(horse_name)")
    .eq("race_id", raceId)
    .order("horse_number");

  const cardRace: CardRace = race;
  const cardEntries: CardEntry[] = (entries ?? []).map((e) => ({
    horse_number: e.horse_number,
    post_position: e.post_position,
    horse_name: e.horses?.horse_name ?? "—",
    odds_win: e.odds_win,
    expected_popularity: e.expected_popularity,
    horse_rank: e.horse_rank,
    is_kesshi: e.is_kesshi,
  }));

  return toPng(
    RaceCard({ race: cardRace, entries: cardEntries, format }),
    format,
    JSON.stringify({ cardRace, cardEntries })
  );
}

export async function renderDigest(
  supabase: Db,
  date: string,
  format: CardFormat,
  titleOverride?: string
): Promise<ImageResponse | null> {
  const { data: races } = await supabase
    .from("races")
    .select(
      "keibajo_name, race_number, race_name, race_class, grade, race_rank, honmei_horse_number, aite_horse_number, aite_horse_number_2"
    )
    .eq("race_date", date)
    .not("race_rank", "is", null)
    .order("race_number");

  const rows: DigestRow[] = races ?? [];
  if (rows.length === 0) return null;

  const title = titleOverride ?? (date > todayJst() ? "あすの診断" : "きょうの診断");
  const dateLabel = formatDateLabel(date);
  return toPng(
    DigestCard({ dateLabel, title, rows, format }),
    format,
    JSON.stringify({ title, dateLabel, rows })
  );
}

export async function renderResults(
  supabase: Db,
  from: string,
  to: string,
  format: CardFormat,
  titleOverride?: string
): Promise<ImageResponse | null> {
  const { data: periodRows } = await supabase
    .from("race_recommendation_results")
    .select(RESULT_SELECT)
    .not("computed_at", "is", null)
    .gte("races.race_date", from)
    .lte("races.race_date", to)
    .returns<ResultJoinRow[]>();

  const rows = periodRows ?? [];
  if (rows.length === 0) return null;

  // 実運用開始日以降の累計(ダッシュボードと同じ範囲)を注記として載せる
  const { data: cumulativeRows } = await supabase
    .from("race_recommendation_results")
    .select(RESULT_SELECT)
    .not("computed_at", "is", null)
    .gte("races.race_date", LIVE_TRACKING_START_DATE)
    .returns<ResultJoinRow[]>();

  let cumulativeNote: string | null = null;
  const cum = cumulativeRows ?? [];
  if (cum.length > 0) {
    const bets = cum.length;
    const hits = cum.filter((r) => r.is_hit).length;
    const stake = cum.reduce((sum, r) => sum + (r.stake_yen ?? 0), 0);
    const ret = cum.reduce((sum, r) => sum + (r.return_yen ?? 0), 0);
    const roi = stake > 0 ? ((ret / stake) * 100).toFixed(1) : "—";
    cumulativeNote = `実運用累計(${LIVE_TRACKING_START_DATE}〜): 購入${bets}件・的中${hits}件(${((hits / bets) * 100).toFixed(1)}%)・回収率${roi}%`;
  }

  const title =
    titleOverride ??
    (from === to
      ? `${formatDateLabel(from)} 結果`
      : `${formatDateLabel(from)}〜${formatDateLabel(to)} 結果`);

  const summary: ResultsSummary = {
    title,
    bets: rows.length,
    hits: rows.filter((r) => r.is_hit).length,
    stakeYen: rows.reduce((sum, r) => sum + (r.stake_yen ?? 0), 0),
    returnYen: rows.reduce((sum, r) => sum + (r.return_yen ?? 0), 0),
    cumulativeNote,
  };
  const resultRows: ResultRow[] = rows.map((r) => ({
    keibajo_name: r.races.keibajo_name,
    race_number: r.races.race_number,
    race_name: r.races.race_name,
    race_class: r.races.race_class,
    race_rank: r.race_rank,
    is_hit: r.is_hit,
    stake_yen: r.stake_yen,
    return_yen: r.return_yen,
  }));

  return toPng(
    ResultsCard({ summary, rows: resultRows, format }),
    format,
    JSON.stringify({ summary, resultRows })
  );
}

export async function toBuffer(res: ImageResponse): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}
