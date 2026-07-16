import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import { RaceCard, type CardEntry, type CardRace } from "@/lib/sns/cards";
import { buildFonts } from "@/lib/sns/font";
import { cardSize, type CardFormat } from "@/lib/sns/theme";

// レース診断カード(SNSシェア画像)。
// GET /api/sns/race-card/[raceId]?format=og(1200x675, 既定) | story(1080x1920)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ raceId: string }> }
) {
  const { raceId } = await params;
  const format: CardFormat =
    new URL(req.url).searchParams.get("format") === "story" ? "story" : "og";

  const supabase = createAdminClient();
  const { data: race } = await supabase
    .from("races")
    .select("*")
    .eq("id", raceId)
    .single();
  if (!race) {
    return new Response("race not found", { status: 404 });
  }

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

  const fonts = await buildFonts(JSON.stringify({ cardRace, cardEntries }));
  return new ImageResponse(
    <RaceCard race={cardRace} entries={cardEntries} format={format} />,
    { ...cardSize(format), fonts }
  );
}
