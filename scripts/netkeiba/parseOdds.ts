// race.netkeiba.com/api/api_get_jra_odds.html のレスポンスパーサー。
//
// なぜ必要か(2026-08-19): odds_win / expected_popularity / race_odds_combinations を
// 書き込めるのはこれまで scripts/jvlink/load_to_supabase.py だけ = **Windows PC + JV-Link が
// 動いている時しかオッズが入らなかった**。実際に2026-08-15/16はオッズ取得に失敗し、全977頭が
// odds_win=0 で埋まった(AGENTS.md参照)。JRAは必ずオッズを公開しているので、これは
// 「オッズが存在しない」のではなく「こちらの取得経路が1本しか無く、それが落ちた」という問題。
// netkeiba側の同じデータをリモート(Mac・クラウド)からも取れるようにして冗長化する。
//
// ⚠️このエンドポイントはshutubaページのフロントエンドが自分で叩いているものであり、認証なしで
// 単勝・馬連・ワイドを返す(netkeibaのHTML表示上は単勝オッズがプレミアム限定になっているが、
// APIの応答自体は素で返ってくる)。既存のnetkeibaスクレイパーと同じく、正直なUser-Agent・
// 5秒以上のリクエスト間隔を守り、1レースにつき必要な回数だけ叩く運用にすること。
//
// 実データ検証(2026-08-19、新潟2026-08-15 11R = race_id 202604020711):
//   馬連9-10  API 98.3倍  → 実配当 9,830円(30番人気) ... 完全一致
//   ワイド10-18 API 3.2〜3.5 → 実配当 350円(1番人気、上限側に着地)
//   ワイド9-18  API 15.2〜16.7 → 実配当 1,520円(18番人気、下限側に着地)
// 単勝もオッズ昇順と人気順1〜18が完全に整合することを確認済み。

export const ODDS_API_BASE = "https://race.netkeiba.com/api/api_get_jra_odds.html";

// netkeibaのtype: 1=単勝, 2=複勝, 3=枠連, 4=馬連, 5=ワイド, 6=馬単, 7=3連複, 8=3連単
export const ODDS_TYPE_TANSHO = 1;
export const ODDS_TYPE_UMAREN = 4;
export const ODDS_TYPE_WIDE = 5;

interface OddsApiResponse {
  status?: string;
  data?: {
    official_datetime?: string;
    // { "1": { "01": ["60.1", "0.0", "12"] } } のような形。外側キーはtypeの文字列。
    odds?: Record<string, Record<string, string[]>>;
  };
}

export interface ParsedWinOdds {
  horseNumber: number;
  oddsWin: number;
  popularity: number;
}

export interface ParsedComboOdds {
  betType: "umaren" | "wide";
  combination: string; // 馬番の昇順を"-"で連結(race_payoutsと同形式、例 "3-5")
  odds: number | null; // 馬連(単一値)
  oddsLow: number | null; // ワイド下限
  oddsHigh: number | null; // ワイド上限
  popularity: number | null;
}

// "1,953.2" のようにカンマ区切りで返ってくる値があるため、必ずカンマを除去してから数値化する。
function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// "0102" → "1-2"。組番は常に2桁ゼロ埋めの馬番2つ。
function toCombination(key: string): string | null {
  if (!/^\d{4}$/.test(key)) return null;
  const a = Number(key.slice(0, 2));
  const b = Number(key.slice(2, 4));
  if (!a || !b) return null;
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function parseWinOdds(json: unknown): ParsedWinOdds[] {
  const res = json as OddsApiResponse;
  const table = res?.data?.odds?.[String(ODDS_TYPE_TANSHO)];
  if (!table) return [];
  const rows: ParsedWinOdds[] = [];
  for (const [key, values] of Object.entries(table)) {
    const horseNumber = Number(key);
    const oddsWin = toNumber(values[0]);
    const popularity = toNumber(values[2]);
    // オッズ0以下は「未確定/取消」を意味するため取り込まない(0を有効値として保存すると
    // 人気順の捏造につながる。AGENTS.mdのodds_win=0問題を参照)。
    if (!horseNumber || oddsWin === null || oddsWin <= 0) continue;
    rows.push({ horseNumber, oddsWin, popularity: popularity ?? 0 });
  }
  return rows.sort((a, b) => a.horseNumber - b.horseNumber);
}

export function parseComboOdds(json: unknown, betType: "umaren" | "wide"): ParsedComboOdds[] {
  const res = json as OddsApiResponse;
  const type = betType === "umaren" ? ODDS_TYPE_UMAREN : ODDS_TYPE_WIDE;
  const table = res?.data?.odds?.[String(type)];
  if (!table) return [];
  const rows: ParsedComboOdds[] = [];
  for (const [key, values] of Object.entries(table)) {
    const combination = toCombination(key);
    if (!combination) continue;
    const first = toNumber(values[0]);
    const second = toNumber(values[1]);
    const popularity = toNumber(values[2]);
    if (first === null || first <= 0) continue;
    if (betType === "umaren") {
      rows.push({ betType, combination, odds: first, oddsLow: null, oddsHigh: null, popularity });
    } else {
      // ワイドは[下限, 上限, 人気]。ワイドは3着以内の2頭の組み合わせなので、どの組が
      // 当たったかで払戻が変わり、実配当はこの範囲内のどこかに着地する(下限固定ではない。
      // 2026-08-15新潟11Rの実データでは 9-18 が下限15.2側=1,520円、10-18 が上限3.5側=350円と
      // 両方向の例が出ている)。妙味を見る時は下限=最悪ケースとして扱うのが安全。
      rows.push({
        betType,
        combination,
        odds: null,
        oddsLow: first,
        oddsHigh: second !== null && second > 0 ? second : null,
        popularity,
      });
    }
  }
  return rows;
}

export function extractOfficialDatetime(json: unknown): string | null {
  const res = json as OddsApiResponse;
  return res?.data?.official_datetime ?? null;
}

export function buildOddsApiUrl(netkeibaRaceId: string, type: number): string {
  return `${ODDS_API_BASE}?race_id=${netkeibaRaceId}&type=${type}&action=init`;
}

export function buildShutubaRefererUrl(netkeibaRaceId: string): string {
  return `https://race.netkeiba.com/race/shutuba.html?race_id=${netkeibaRaceId}`;
}
