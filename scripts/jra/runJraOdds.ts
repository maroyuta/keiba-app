import { crawlAndSyncJraOdds } from "./syncJraOdds";
import { loadEnvFileFromArgs } from "../netkeiba/loadEnvFile";

// 使い方: npx tsx scripts/jra/runJraOdds.ts --url "https://www.jra.go.jp/JRADB/accessD.html?CNAME=..." --date 2026-07-18 [--env-file .env.local]
// startUrl 1本から、同一開催場の1〜12R・他開催場の注目レースへのリンクを辿って
// targetDateに一致するレースのみオッズ・人気をrace_entriesへ反映する。
async function main() {
  const args = loadEnvFileFromArgs(process.argv.slice(2));
  const urlIdx = args.indexOf("--url");
  const dateIdx = args.indexOf("--date");
  const url = urlIdx !== -1 ? args[urlIdx + 1] : undefined;
  const date = dateIdx !== -1 ? args[dateIdx + 1] : undefined;

  if (!url || !date) {
    console.error(
      "使い方: npx tsx scripts/jra/runJraOdds.ts --url <accessD.html?CNAME=...のURL> --date YYYY-MM-DD",
    );
    process.exit(1);
  }

  const summaries = await crawlAndSyncJraOdds(url, date);

  console.log("\n=== 同期結果 ===");
  let totalUpdated = 0;
  let okCount = 0;
  for (const s of summaries) {
    console.log(
      `${s.keibajoCode ?? "?"}場 ${s.raceNumber ?? "?"}R: ${s.status} (oddsUpdated=${s.oddsUpdated})`,
    );
    totalUpdated += s.oddsUpdated;
    if (s.status === "ok") okCount++;
  }
  console.log(`\n訪問レース数=${summaries.length}、成功=${okCount}、オッズ更新合計=${totalUpdated}件`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
