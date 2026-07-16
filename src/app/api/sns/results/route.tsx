import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ResultsCard,
  formatDateLabel,
  type ResultRow,
  type ResultsSummary,
} from "@/lib/sns/cards";
import { buildFonts } from "@/lib/sns/font";
import { cardSize, type CardFormat } from "@/lib/sns/theme";

// /dashboard(page.tsx)のLIVE_TRACKING_START_DATEと同じ。実運用の累計はこの日以降のみ。
const LIVE_TRACKING_START_DATE = "2026-07-18";

type ResultJoinRow = {
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

// 結果・収支カード。
// GET /api/sns/results?from=YYYY-MM-DD&to=YYYY-MM-DD&format=og|story&title=...
// fromのみ指定なら単日(from=to)。集計対象は確定済み(computed_atあり)のみ。
export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  if (!from) {
    return new Response("from is required (YYYY-MM-DD)", { status: 400 });
  }
  const to = url.searchParams.get("to") ?? from;
  const format: CardFormat = url.searchParams.get("format") === "story" ? "story" : "og";

  const supabase = createAdminClient();
  const select =
    "is_hit, stake_yen, return_yen, race_rank, races!inner(race_date, keibajo_name, race_number, race_name, race_class)";
  const { data: periodRows } = await supabase
    .from("race_recommendation_results")
    .select(select)
    .not("computed_at", "is", null)
    .gte("races.race_date", from)
    .lte("races.race_date", to)
    .returns<ResultJoinRow[]>();

  const rows = periodRows ?? [];
  if (rows.length === 0) {
    return new Response(`no computed results between ${from} and ${to}`, { status: 404 });
  }

  // 実運用開始日以降の累計(ダッシュボードと同じ範囲)を注記として載せる
  const { data: cumulativeRows } = await supabase
    .from("race_recommendation_results")
    .select(select)
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
    url.searchParams.get("title") ??
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

  const fonts = await buildFonts(JSON.stringify({ summary, resultRows }));
  return new ImageResponse(
    <ResultsCard summary={summary} rows={resultRows} format={format} />,
    { ...cardSize(format), fonts }
  );
}
