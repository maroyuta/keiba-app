import { createAdminClient } from "@/lib/supabase/admin";
import { renderRaceCard } from "@/lib/sns/render";
import type { CardFormat } from "@/lib/sns/theme";

// レース診断カード(SNSシェア画像)。実処理はsrc/lib/sns/render.ts(バッチと共用)。
// GET /api/sns/race-card/[raceId]?format=og(1200x675, 既定) | story(1080x1920)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ raceId: string }> }
) {
  const { raceId } = await params;
  const format: CardFormat =
    new URL(req.url).searchParams.get("format") === "story" ? "story" : "og";

  const res = await renderRaceCard(createAdminClient(), raceId, format);
  return res ?? new Response("race not found", { status: 404 });
}
