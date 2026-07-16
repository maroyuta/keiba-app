import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import { DigestCard, formatDateLabel, type DigestRow } from "@/lib/sns/cards";
import { buildFonts } from "@/lib/sns/font";
import { cardSize, type CardFormat } from "@/lib/sns/theme";

function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 当日/前日ダイジェストカード(その日の診断済みレース一覧)。
// GET /api/sns/digest?date=YYYY-MM-DD(既定: JST今日)&format=og|story&title=...
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? todayJst();
  const format: CardFormat = url.searchParams.get("format") === "story" ? "story" : "og";
  const title =
    url.searchParams.get("title") ?? (date > todayJst() ? "あすの診断" : "きょうの診断");

  const supabase = createAdminClient();
  const { data: races } = await supabase
    .from("races")
    .select(
      "keibajo_name, race_number, race_name, race_class, grade, race_rank, honmei_horse_number, aite_horse_number"
    )
    .eq("race_date", date)
    .not("race_rank", "is", null)
    .order("race_number");

  const rows: DigestRow[] = races ?? [];
  if (rows.length === 0) {
    return new Response(`no diagnosed races on ${date}`, { status: 404 });
  }

  const dateLabel = formatDateLabel(date);
  const fonts = await buildFonts(JSON.stringify({ title, dateLabel, rows }));
  return new ImageResponse(
    <DigestCard dateLabel={dateLabel} title={title} rows={rows} format={format} />,
    { ...cardSize(format), fonts }
  );
}
