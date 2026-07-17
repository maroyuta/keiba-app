import { createAdminClient } from "@/lib/supabase/admin";
import { renderDigest, todayJst } from "@/lib/sns/render";
import type { CardFormat } from "@/lib/sns/theme";

// 当日/前日ダイジェストカード。実処理はsrc/lib/sns/render.ts(バッチと共用)。
// GET /api/sns/digest?date=YYYY-MM-DD(既定: JST今日)&format=og|story&title=...
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? todayJst();
  const format: CardFormat = url.searchParams.get("format") === "story" ? "story" : "og";
  const title = url.searchParams.get("title") ?? undefined;

  const res = await renderDigest(createAdminClient(), date, format, title);
  return res ?? new Response(`no diagnosed races on ${date}`, { status: 404 });
}
