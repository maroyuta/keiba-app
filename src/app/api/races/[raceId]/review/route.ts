import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 「このレースもう確認したっけ」が分からない、というユーザー指摘への対応(2026-07-19)。
// 診断ロジックとは無関係な閲覧状態フラグ(races.reviewed_at)を手動でON/OFFするだけのAPI。
export async function POST(
  _request: Request,
  context: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await context.params;
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("races")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("id", raceId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await context.params;
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("races")
    .update({ reviewed_at: null })
    .eq("id", raceId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
