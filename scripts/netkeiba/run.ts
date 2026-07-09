import { syncPastPerformances } from "./syncPastPerformances";

// 使い方: npm run sync:netkeiba -- 202610010301 202610010302 ...
// race_idはnetkeiba race.netkeiba.com/race/result.html?race_id=XXXXXXXXXXXX のクエリパラメータ。
async function main() {
  const raceIds = process.argv.slice(2);
  if (raceIds.length === 0) {
    console.error("使い方: npm run sync:netkeiba -- <race_id> [<race_id> ...]");
    process.exit(1);
  }

  const summaries = await syncPastPerformances(raceIds);

  console.log("\n=== 同期結果 ===");
  for (const summary of summaries) {
    console.log(
      `${summary.raceId}: ${summary.status} (upserted=${summary.upserted}, skipped=${summary.skippedUnknownHorses.length})`,
    );
    if (summary.skippedUnknownHorses.length > 0) {
      console.log(`  未登録馬のためスキップ: ${summary.skippedUnknownHorses.join(", ")}`);
    }
  }

  const failed = summaries.filter((s) => s.status !== "ok");
  if (failed.length > 0) {
    console.warn(`\n${failed.length}件のレースで取得に失敗しました。一部データ取得失敗として扱い、処理は継続済みです。`);
  }
}

main().catch((err) => {
  console.error("[netkeiba] 同期処理が予期せず失敗しました:", err);
  process.exit(1);
});
