import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// JV-Linkと同じくWindows PC側のバッチから叩く想定のためAPI Routeとは別クライアントを持つ。
// service_roleキーはこのプロセス限りで使い、Next.js側のコードとは共有しない。
//
// fetchにタイムアウトを付けている: 2026-07-12、この設定なしのクライアントで大量馬の
// 一括取得中にリクエストが2時間以上ハングする事故が実際に発生した。
const SUPABASE_REQUEST_TIMEOUT_MS = 30000;

export function createNetkeibaSyncClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が環境変数に設定されていません",
    );
  }
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS) }),
    },
  });
}
