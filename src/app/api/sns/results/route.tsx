import { createAdminClient } from "@/lib/supabase/admin";
import { renderResults } from "@/lib/sns/render";
import type { CardFormat } from "@/lib/sns/theme";

// 結果・収支カード。実処理はsrc/lib/sns/render.ts(バッチと共用)。
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
  const title = url.searchParams.get("title") ?? undefined;

  const res = await renderResults(createAdminClient(), from, to, format, title);
  return res ?? new Response(`no computed results between ${from} and ${to}`, { status: 404 });
}
