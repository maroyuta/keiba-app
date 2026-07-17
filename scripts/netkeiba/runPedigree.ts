import { syncPedigree } from "./syncPedigree";
import { loadEnvFileFromArgs } from "./loadEnvFile";

// 使い方: npm run sync:netkeiba:pedigree -- 2023103929 2023101676 ... [--env-file <path>]
// 引数はhorses.jv_horse_id(JV-Data血統登録番号、10桁)。
async function main() {
  const jvHorseIds = loadEnvFileFromArgs(process.argv.slice(2));
  if (jvHorseIds.length === 0) {
    console.error("使い方: npm run sync:netkeiba:pedigree -- <jv_horse_id> [<jv_horse_id> ...]");
    process.exit(1);
  }

  const summaries = await syncPedigree(jvHorseIds);

  console.log("\n=== 同期結果 ===");
  let ok = 0;
  for (const s of summaries) {
    console.log(`${s.jvHorseId}: ${s.status}`);
    if (s.status === "ok") ok++;
  }
  console.log(`\n合計成功=${ok}件 / 全${summaries.length}件`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
