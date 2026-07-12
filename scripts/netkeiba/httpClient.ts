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
//
// race.netkeiba.com は charset=UTF-8 だが、db.netkeiba.com (馬個別ページ) は
// charset=euc-jp のため、fetchのResponse.text()(常にUTF-8として解釈する仕様)を
// そのまま使うと文字化けする。encoding引数でバイト列から明示的にデコードする。
export async function fetchNetkeibaHtml(
  url: string,
  encoding: "utf-8" | "euc-jp" = "utf-8",
): Promise<string | null> {
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
    if (encoding === "utf-8") {
      return await response.text();
    }
    const buffer = await response.arrayBuffer();
    return new TextDecoder(encoding).decode(buffer);
  } catch (err) {
    console.warn(`[netkeiba] fetch failed for ${url}:`, err);
    return null;
  }
}
