import { syncShutuba } from "./syncShutuba";
import { discoverRaceIdsByDate } from "./discoverRaceIdsByDate";
import { loadEnvFileFromArgs } from "./loadEnvFile";

// 使い方:
//   npm run sync:netkeiba:shutuba -- --date 20260719 [--env-file <path>]  (その日の全レースを自動検出)
//   npm run sync:netkeiba:shutuba -- 202610020811 [--env-file <path>]     (race_idを直接指定)
//
// JV-Link(Windows、週次)がまだ同期していない未来のレースについて、netkeibaの出馬表から
// races/horses/race_entriesを先回りで作成する。詳細はsyncShutuba.ts参照。
async function main() {
  const args = loadEnvFileFromArgs(process.argv.slice(2));
  const dateIdx = args.indexOf("--date");

  let raceIds: string[];
  if (dateIdx !== -1) {
    const date = args[dateIdx + 1];
    if (!date) {
      console.error("使い方: npm run sync:netkeiba:shutuba -- --date YYYYMMDD [--env-file <path>]");
      process.exit(1);
    }
    raceIds = await discoverRaceIdsByDate(date);
    if (raceIds.length === 0) {
      console.log(`[info] ${date}の出馬表がまだnetkeibaに掲載されていません(発表待ちの可能性があります)`);
      return;
    }
    console.log(`[info] ${date}の${raceIds.length}レースを同期します`);
  } else {
    raceIds = args.filter((a) => /^\d{12}$/.test(a));
    if (raceIds.length === 0) {
      console.error("使い方: npm run sync:netkeiba:shutuba -- --date YYYYMMDD | <race_id> [<race_id> ...]");
      process.exit(1);
    }
  }

  const summaries = await syncShutuba(raceIds);

  console.log("\n=== 同期結果 ===");
  let racesCreated = 0;
  let entriesInserted = 0;
  for (const s of summaries) {
    if (s.raceCreated) racesCreated += 1;
    entriesInserted += s.entriesInserted;
    console.log(
      `${s.raceId}: ${s.status} (raceCreated=${s.raceCreated}, horses=${s.horsesUpserted}, ` +
        `entriesInserted=${s.entriesInserted}, 抽選待ち=${s.entriesSkippedNotDrawn})`,
    );
  }
  const excluded = summaries.filter((s) => s.status === "skipped_excluded_class");
  const failed = summaries.filter((s) => s.status !== "ok" && s.status !== "skipped_excluded_class");
  console.log(
    `\nraces新規作成=${racesCreated}件、race_entries作成=${entriesInserted}件、` +
      `新馬/未勝利で除外=${excluded.length}件、失敗=${failed.length}件`,
  );
}

main().catch((err) => {
  console.error("[netkeiba] 出馬表同期が予期せず失敗しました:", err);
  process.exit(1);
});
