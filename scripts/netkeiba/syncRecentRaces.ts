import { syncPastPerformances } from "./syncPastPerformances";
import { loadEnvFileFromArgs } from "./loadEnvFile";
import { createNetkeibaSyncClient } from "./supabaseClient";

// 定期実行(週次想定)から呼ぶラッパー。「races」テーブル自体から直近N日分のjv_race_keyを
// 引いてnetkeibaへ同期する。netkeiba race_idはjv_race_keyと同一フォーマットであることを
// 実データで確認済み(2026-07-12、AGENTS.md参照)。
//
// 使い方: npm run sync:netkeiba:recent -- [--days N] [--env-file <path>]
// --days省略時は7(直近1週間)。障害レースはparseRaceResult.tsの既知の不具合(agari_3f_sec等が
// 壊れる)があるため対象外。--env-fileはWindowsタスクスケジューラ等、シェルでの`source`が
// 使えない環境向け(scripts/jvlink/load_to_supabase.pyの--env-fileと同じ設計)。

function parseDaysArg(argv: string[]): number {
  const idx = argv.indexOf("--days");
  if (idx === -1) return 7;
  const value = Number(argv[idx + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("--days には正の整数を指定してください");
  }
  return value;
}

async function main() {
  const args = loadEnvFileFromArgs(process.argv.slice(2));
  const days = parseDaysArg(args);
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  const supabase = createNetkeibaSyncClient();
  const { data: races, error } = await supabase
    .from("races")
    .select("jv_race_key, race_date, keibajo_name, race_number, track_type")
    .gte("race_date", sinceStr)
    // 当日・未来のレースは除外する。含めてしまうと、まだ走っていない(または
    // JV-Link側で結果未確定の)レースをnetkeibaから取得してしまい、対象レース自身が
    // 「過去走」として自己参照する事故につながる(2026-07-12、七夕賞の手動バックフィルで
    // 実際に発生・発覚した)。
    .lt("race_date", todayStr)
    .neq("track_type", "障害");
  if (error) {
    throw new Error(`racesの取得に失敗しました: ${error.message}`);
  }
  if (!races || races.length === 0) {
    console.log(`[info] ${sinceStr}以降の対象レースが見つかりませんでした`);
    return;
  }

  console.log(`[info] ${sinceStr}以降の${races.length}レースを同期します`);
  const raceIds = races.map((r) => r.jv_race_key);
  const summaries = await syncPastPerformances(raceIds);

  console.log("\n=== 同期結果 ===");
  let totalUpserted = 0;
  for (const summary of summaries) {
    totalUpserted += summary.upserted;
    console.log(
      `${summary.raceId}: ${summary.status} (upserted=${summary.upserted}, skipped=${summary.skippedUnknownHorses.length})`,
    );
  }
  const failed = summaries.filter((s) => s.status !== "ok");
  console.log(`\n合計upserted=${totalUpserted}件、失敗=${failed.length}件`);
}

main().catch((err) => {
  console.error("[netkeiba] 定期同期が予期せず失敗しました:", err);
  process.exit(1);
});
