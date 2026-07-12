import { syncHorseHistory } from "./syncHorseHistory";
import { loadEnvFileFromArgs } from "./loadEnvFile";

// 使い方: npm run sync:netkeiba:horse -- 2023103929 2023101676 ... [--env-file <path>]
// 引数はhorses.jv_horse_id(JV-Data血統登録番号、10桁)。db.netkeiba.com/horse/result/{id}/
// から馬の全レース履歴をまとめて取得し、past_performancesへ反映する。
async function main() {
  const jvHorseIds = loadEnvFileFromArgs(process.argv.slice(2));
  if (jvHorseIds.length === 0) {
    console.error("使い方: npm run sync:netkeiba:horse -- <jv_horse_id> [<jv_horse_id> ...]");
    process.exit(1);
  }

  const summaries = await syncHorseHistory(jvHorseIds);

  console.log("\n=== 同期結果 ===");
  let totalUpserted = 0;
  for (const summary of summaries) {
    totalUpserted += summary.upserted;
    console.log(`${summary.jvHorseId}: ${summary.status} (upserted=${summary.upserted})`);
  }
  console.log(`\n合計upserted=${totalUpserted}件`);
}

main().catch((err) => {
  console.error("[netkeiba] 馬個別ページ同期が予期せず失敗しました:", err);
  process.exit(1);
});
