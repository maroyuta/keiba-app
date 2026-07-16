import { syncPayouts } from "./syncPayouts";
import { loadEnvFileFromArgs } from "./loadEnvFile";
import { createNetkeibaSyncClient } from "./supabaseClient";

// 指定日のracesからjv_race_keyを引いて、そのままnetkeiba race_idとしてrace_payoutsを同期する
// (netkeiba race_id = jv_race_keyの一致は既存のsyncPastPerformances.tsで実データ検証済み)。
// 障害レースは配当自体は取れるが診断対象外のため除外。当日・未来のレースは配当が未確定のため除外。
// ただし当日の全レース終了後(夕方)にSNS結果報告用の同期をしたい場合は--allow-todayで
// 当日のみ許可できる(未来の日付は引き続き不可)。
//
// 使い方: npm run sync:netkeiba:payouts -- --date 2026-07-11 [--allow-today] [--env-file <path>]
async function main() {
  const args = loadEnvFileFromArgs(process.argv.slice(2));
  const dateIdx = args.indexOf("--date");
  const date = dateIdx !== -1 ? args[dateIdx + 1] : null;
  if (!date) {
    console.error("使い方: npm run sync:netkeiba:payouts -- --date YYYY-MM-DD [--env-file <path>]");
    process.exit(1);
  }

  const allowToday = args.includes("--allow-today");
  // JST基準の今日(サーバーTZに依存させない)
  const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (date > todayStr || (date === todayStr && !allowToday)) {
    console.error(
      `${date}は当日・未来の日付です。配当が確定済みの過去日のみ指定してください。` +
        `(当日の全レース終了後なら--allow-todayで実行可能)`
    );
    process.exit(1);
  }

  const supabase = createNetkeibaSyncClient();
  const { data: races, error } = await supabase
    .from("races")
    .select("jv_race_key, keibajo_name, race_number")
    .eq("race_date", date)
    .neq("track_type", "障害");
  if (error) {
    throw new Error(`racesの取得に失敗しました: ${error.message}`);
  }
  if (!races || races.length === 0) {
    console.log(`[info] ${date}の対象レースが見つかりませんでした`);
    return;
  }

  console.log(`[info] ${date}の${races.length}レースの配当を同期します`);
  const raceIds = races.map((r) => r.jv_race_key);
  const summaries = await syncPayouts(raceIds);

  console.log("\n=== 同期結果 ===");
  let totalUpserted = 0;
  let totalEntriesUpdated = 0;
  for (const summary of summaries) {
    totalUpserted += summary.upserted;
    totalEntriesUpdated += summary.entriesUpdated;
    console.log(
      `${summary.raceId}: ${summary.status} (upserted=${summary.upserted}, entriesUpdated=${summary.entriesUpdated})`,
    );
  }
  const failed = summaries.filter((s) => s.status !== "ok");
  console.log(
    `\n合計upserted=${totalUpserted}件、race_entries更新=${totalEntriesUpdated}件、失敗=${failed.length}件`,
  );
}

main().catch((err) => {
  console.error("[netkeiba] 配当同期が予期せず失敗しました:", err);
  process.exit(1);
});
