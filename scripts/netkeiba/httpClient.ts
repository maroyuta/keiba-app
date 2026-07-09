// netkeibaへのリクエストクライアント。
// AGENTS.mdの対応方針に従い、正直なUser-Agentと十分なリクエスト間隔を守る。
// playwright-stealth等の検知回避技術は使わない。

const NETKEIBA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// 短時間の連続アクセスによるIPブロックを避けるための最小リクエスト間隔。
const MIN_REQUEST_INTERVAL_MS = 5000;

let lastRequestAt = 0;

async function waitForRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  const remaining = MIN_REQUEST_INTERVAL_MS - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  lastRequestAt = Date.now();
}

// 取得失敗時はnullを返す (呼び出し側でグレースフルデグラデーションする想定。例外は投げない)。
export async function fetchNetkeibaHtml(url: string): Promise<string | null> {
  await waitForRateLimit();
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": NETKEIBA_USER_AGENT,
        "Accept-Language": "ja,en;q=0.8",
      },
    });
    if (!response.ok) {
      console.warn(`[netkeiba] ${url} -> HTTP ${response.status}`);
      return null;
    }
    return await response.text();
  } catch (err) {
    console.warn(`[netkeiba] fetch failed for ${url}:`, err);
    return null;
  }
}
