import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

// App Router (RSC/Server Action/Route Handler) から呼び出すクライアント。
// RLSを通す通常アクセス用。認証つきセッションで利用する。
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Componentから呼ばれた場合はcookie書き込み不可。
            // middlewareでセッションrefreshしていれば無視してよい。
          }
        },
      },
    }
  );
}
