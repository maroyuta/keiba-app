import { syncHistoricalRaces } from "./syncHistoricalRaces";
import { syncPayouts } from "./syncPayouts";
import { discoverRaceIdsByDate } from "./discoverRaceIdsByDate";
import { loadEnvFileFromArgs } from "./loadEnvFile";

// 使い方: npm run sync:netkeiba:historical -- --date YYYYMMDD [--env-file <path>]
//
// JV-Linkがまだ同期していない過去日について、races/horses/race_entriesを新規作成し
// (syncHistoricalRaces)、続けて既存のsyncPayoutsを流用して配当・確定オッズ/着順・race_classを
// 埋める。バックテスト対象をJV-Link同期済みの日付(07-04/05/11)より前に広げるために新設した。
async function main() {
  const args = loadEnvFileFromArgs(process.argv.slice(2));
  const dateIdx = args.indexOf("--date");
  const date = dateIdx !== -1 ? args[dateIdx + 1] : null;
  if (!date) {
    console.error("使い方: npm run sync:netkeiba:historical -- --date YYYYMMDD [--env-file <path>]");
    process.exit(1);
  }

  const raceIds = await discoverRaceIdsByDate(date);
  if (raceIds.length === 0) {
    console.log(`[info] ${date}のレースが見つかりませんでした`);
    return;
  }
  console.log(`[info] ${date}の${raceIds.length}レースを同期します`);

  console.log("\n=== races/horses/race_entries 作成 ===");
  const raceSummaries = await syncHistoricalRaces(raceIds);
  let racesCreated = 0;
  let entriesInserted = 0;
  for (const s of raceSummaries) {
    if (s.raceCreated) racesCreated += 1;
    entriesInserted += s.entriesInserted;
    console.log(
      `${s.raceId}: ${s.status} (raceCreated=${s.raceCreated}, horses=${s.horsesUpserted}, entries=${s.entriesInserted})`,
    );
  }

  console.log("\n=== 配当・確定オッズ/着順の反映 ===");
  const payoutSummaries = await syncPayouts(raceIds);
  let payoutsUpserted = 0;
  let entriesUpdated = 0;
  for (const s of payoutSummaries) {
    payoutsUpserted += s.upserted;
    entriesUpdated += s.entriesUpdated;
    console.log(`${s.raceId}: ${s.status} (payouts=${s.upserted}, entriesUpdated=${s.entriesUpdated})`);
  }

  console.log(
    `\nraces新規作成=${racesCreated}件、race_entries作成=${entriesInserted}件、` +
      `payouts upsert=${payoutsUpserted}件、entries確定値更新=${entriesUpdated}件`,
  );
}

main().catch((err) => {
  console.error("[netkeiba] 過去レース同期が予期せず失敗しました:", err);
  process.exit(1);
});
