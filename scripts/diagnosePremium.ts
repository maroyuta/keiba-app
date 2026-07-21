import { loadEnvFileFromArgs } from "./netkeiba/loadEnvFile";
import { createNetkeibaSyncClient } from "./netkeiba/supabaseClient";

// 「本気診断(premium/Opus)」をローカルの Mac で全力(effort=xhigh)で回すためのランナー。
//
// なぜ専用スクリプトが要るか:
//   Vercel Hobbyプランのサーバーレス関数は maxDuration 300秒がハード上限で、Opus xhigh診断
//   (実測200〜400秒)はタイムアウトする。そのため Vercel 上のボタンは effort=high に格下げ
//   されている(predict.ts の premiumEffort() 参照)。一方、Mac 上で `next dev`/`next start` を
//   叩く経路には maxDuration の制約が効かないため、全力(xhigh)で完走できる。
//
// 前提:
//   1. `.env.local` に `PREMIUM_EFFORT=xhigh` を入れておく(未設定だと high のまま格下げ実行になる)
//   2. 別ターミナルで `npm run dev`(または `npm run build && npm run start`)を起動しておく
//   3. 対象レースの枠順・当日オッズが同期済みで、過去走データも十分あること(有料実行のため)
//
// 使い方:
//   npm run diagnose:premium -- --race <raceId> [--race <raceId> ...] [--env-file .env.local]
//   npm run diagnose:premium -- --date YYYY-MM-DD [--env-file .env.local]   # その日の本気診断対象を全件
//   任意で --base-url http://localhost:3000(デフォルト同値)、--dry-run で対象確認のみ

const DEFAULT_BASE_URL = "http://localhost:3000";
const DELAY_BETWEEN_RACES_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) values.push(args[i + 1]);
  }
  return values;
}

async function main() {
  const args = loadEnvFileFromArgs(process.argv.slice(2));
  const raceIds = collectFlag(args, "--race");
  const dates = collectFlag(args, "--date");
  const baseUrlIdx = args.indexOf("--base-url");
  const baseUrl = baseUrlIdx !== -1 ? args[baseUrlIdx + 1] : DEFAULT_BASE_URL;
  const dryRun = args.includes("--dry-run");

  if (raceIds.length === 0 && dates.length === 0) {
    console.error(
      "使い方: npm run diagnose:premium -- --race <raceId> [--race ...] | --date YYYY-MM-DD [--env-file .env.local] [--dry-run]",
    );
    process.exit(1);
  }

  // 全力の意味がある経路かを起動時に警告する(格下げ実行を気づかず回して課金する事故を防ぐ)。
  const effort = process.env.PREMIUM_EFFORT === "xhigh" ? "xhigh" : "high";
  if (effort !== "xhigh") {
    console.warn(
      "[warn] PREMIUM_EFFORT が xhigh ではありません(現在: high 相当)。全力の本気診断にするには " +
        ".env.local に PREMIUM_EFFORT=xhigh を入れて next dev を再起動してください。このまま high で続行します。",
    );
  }
  if (baseUrl.includes("vercel.app")) {
    console.warn(
      "[warn] base-url が Vercel を指しています。Vercel は300秒でタイムアウトするため本気診断は完走しません。" +
        "ローカルの next dev(http://localhost:3000)を指してください。",
    );
  }

  const supabase = createNetkeibaSyncClient();

  // 対象レースを解決する。--date 指定時は route.ts の premium ゲートと同じ条件で事前フィルタ
  // (grade あり、または race_rank が S/A。未勝利・新馬・障害は対象外)して無駄撃ちを防ぐ。
  type Target = {
    id: string;
    label: string;
  };
  const targets: Target[] = [];

  if (raceIds.length > 0) {
    const { data, error } = await supabase
      .from("races")
      .select("id, race_number, keibajo_name, race_name, race_class")
      .in("id", raceIds);
    if (error) throw new Error(`races取得に失敗: ${error.message}`);
    for (const r of data ?? []) {
      targets.push({
        id: r.id,
        label: `${r.keibajo_name ?? "?"}${r.race_number ?? "?"}R ${r.race_name ?? r.race_class ?? ""}`,
      });
    }
    const found = new Set((data ?? []).map((r) => r.id));
    for (const id of raceIds) {
      if (!found.has(id)) console.warn(`[warn] race_id が見つかりません: ${id}`);
    }
  }

  for (const date of dates) {
    const { data, error } = await supabase
      .from("races")
      .select("id, race_number, keibajo_name, race_name, race_class, race_rank, grade, track_type")
      .eq("race_date", date)
      .order("keibajo_code", { ascending: true })
      .order("race_number", { ascending: true });
    if (error) throw new Error(`races取得に失敗(${date}): ${error.message}`);
    for (const r of data ?? []) {
      const eligible =
        r.track_type !== "障害" &&
        !r.race_class?.includes("未勝利") &&
        !r.race_class?.includes("新馬") &&
        (r.grade !== null || r.race_rank === "S" || r.race_rank === "A");
      if (!eligible) continue;
      targets.push({
        id: r.id,
        label: `${r.keibajo_name ?? "?"}${r.race_number ?? "?"}R ${r.race_name ?? r.race_class ?? ""} (rank=${r.race_rank ?? "-"}, grade=${r.grade ?? "-"})`,
      });
    }
  }

  if (targets.length === 0) {
    console.log("[info] 本気診断の対象レースがありません(--date の場合は grade あり or rank=S/A のみ対象)。");
    return;
  }

  console.log(`[info] 本気診断(effort=${effort})対象: ${targets.length}件 → ${baseUrl}`);
  for (const t of targets) console.log(`  - ${t.label}  [${t.id}]`);

  if (dryRun) {
    console.log("[dry-run] 実際のAPI呼び出しはしません。");
    return;
  }

  const runStart = new Date().toISOString();
  let ok = 0;
  let failed = 0;
  for (const t of targets) {
    const url = `${baseUrl}/api/races/${t.id}/diagnose?tier=premium`;
    const startedAt = Date.now();
    console.log(`\n[run] ${t.label} … (数分かかります)`);
    try {
      const res = await fetch(url, { method: "POST" });
      const body = await res.json().catch(() => null);
      const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
      if (!res.ok) {
        failed += 1;
        console.warn(`[warn] 失敗 (${res.status}, ${secs}秒):`, body);
      } else {
        ok += 1;
        console.log(
          `[ok] tier=${body?.tier} race_rank=${body?.result?.race_rank ?? "-"} ` +
            `本命=${body?.result?.honmei_horse_number ?? "-"} 相手=${body?.result?.aite_horse_number ?? "-"} (${secs}秒)`,
        );
      }
    } catch (err) {
      failed += 1;
      console.warn(`[warn] 通信エラー:`, err);
    }
    await sleep(DELAY_BETWEEN_RACES_MS);
  }

  const { data: usageRows } = await supabase
    .from("api_usage_log")
    .select("estimated_cost_usd")
    .in("race_id", targets.map((t) => t.id))
    .eq("tier", "premium")
    .gte("created_at", runStart);
  const totalCostUsd = (usageRows ?? []).reduce((sum, r) => sum + (r.estimated_cost_usd ?? 0), 0);

  console.log(
    `\n=== 完了 === 成功=${ok}件 失敗=${failed}件 実測コスト=$${totalCostUsd.toFixed(4)}` +
      `(≈¥${Math.round(totalCostUsd * 150)})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
