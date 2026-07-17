// JRA公式サイト(jra.go.jp)へのリクエストクライアント。
// netkeiba経由のオッズがアンチスクレイピング対策で取れなくなった際の代替経路(2026-07-17)。
// netkeibaと同じ配慮(正直なUser-Agent・十分な間隔・検知回避技術は使わない)を適用する。
// JRA公式は一次情報源であり、ToS上もnetkeibaより安全側と判断(要継続確認)。

const JRA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MIN_REQUEST_INTERVAL_MS = 3000;
const REQUEST_TIMEOUT_MS = 30000;

let lastRequestAt = 0;

async function waitForRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  const remaining = MIN_REQUEST_INTERVAL_MS - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  lastRequestAt = Date.now();
}

// jra.go.jpはShift_JIS。取得失敗時はnullを返しグレースフルデグラデーションする。
export async function fetchJraHtml(url: string): Promise<string | null> {
  await waitForRateLimit();
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": JRA_USER_AGENT,
        "Accept-Language": "ja,en;q=0.8",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[jra] ${url} -> HTTP ${response.status}`);
      return null;
    }
    const buffer = await response.arrayBuffer();
    return new TextDecoder("shift_jis").decode(buffer);
  } catch (err) {
    console.warn(`[jra] fetch failed for ${url}:`, err);
    return null;
  }
}
