import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncOddsForRaces } from "../../../../../../scripts/netkeiba/syncOdds";

// netkeibaのオッズAPI(認証不要、race.netkeiba.com/api/api_get_jra_odds.html)経由で
// 単勝・馬連・ワイドを取得しrace_entries/race_odds_combinationsへ反映する。
// JV-Link(Windows)が動いていない週末でも、このボタン一つでオッズを取得できるようにする。
// 単勝・馬連・ワイドの3リクエストで5秒間隔のレート制限があるため10〜15秒程度かかる。
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await params;
  const supabase = createAdminClient();

  const { data: race, error } = await supabase
    .from("races")
    .select("jv_race_key")
    .eq("id", raceId)
    .single();
  if (error || !race) {
    return NextResponse.json({ error: "レースが見つかりません" }, { status: 404 });
  }

  const [summary] = await syncOddsForRaces([race.jv_race_key]);
  if (!summary) {
    return NextResponse.json({ error: "オッズ取得に失敗しました" }, { status: 500 });
  }
  if (summary.status === "fetch_failed") {
    return NextResponse.json({ error: "netkeibaからのオッズ取得に失敗しました" }, { status: 502 });
  }
  if (summary.status === "no_odds") {
    return NextResponse.json({ error: "まだ発売前のためオッズがありません" }, { status: 409 });
  }

  return NextResponse.json({
    status: summary.status,
    officialDatetime: summary.officialDatetime,
    entriesUpdated: summary.entriesUpdated,
    combinationsUpserted: summary.combinationsUpserted,
  });
}
