import { syncShutuba } from "./syncShutuba";
import { discoverRaceIdsByDate } from "./discoverRaceIdsByDate";
import { loadEnvFileFromArgs } from "./loadEnvFile";
import { createNetkeibaSyncClient } from "./supabaseClient";

// Mac側のlaunchdから毎日呼ぶ想定のウォッチャー。今日から数日先までの開催日を総当たりで
// discoverRaceIdsByDate→syncShutubaにかけ、新規公開されたレース・枠順確定を自動的に拾う。
// レースが無い日・まだnetkeibaに未発表の日はdiscoverが空配列を返すだけで実害なし
// (syncShutuba側は既存行を上書きしないinsert-only設計のため、毎日重複実行しても安全)。
//
// 使い方: npm run sync:netkeiba:shutuba-watch -- [--env-file <path>]
const LOOKAHEAD_DAYS = 10;
const JOB_NAME = "sync_netkeiba_shutuba";

type SyncClient = ReturnType<typeof createNetkeibaSyncClient>;

async function startPipelineRun(supabase: SyncClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("pipeline_runs")
    .insert({ job_name: JOB_NAME, status: "running" })
    .select("id")
    .single();
  if (error) {
    console.warn("[pipeline_runs] 記録に失敗しましたが処理は継続します:", error.message);
    return null;
  }
  return data.id;
}

async function finishPipelineRun(
  supabase: SyncClient,
  runId: string | null,
  status: "success" | "failed",
  errorMessage?: string,
): Promise<void> {
  if (!runId) return;
  const { error } = await supabase
    .from("pipeline_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      error_message: errorMessage?.slice(0, 2000),
    })
    .eq("id", runId);
  if (error) {
    console.warn("[pipeline_runs] 記録に失敗しましたが処理は継続します:", error.message);
  }
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  loadEnvFileFromArgs(process.argv.slice(2));
  const supabase = createNetkeibaSyncClient();
  const runId = await startPipelineRun(supabase);

  try {
    let totalRacesCreated = 0;
    let totalEntriesInserted = 0;
    let totalFailed = 0;

    for (let i = 0; i <= LOOKAHEAD_DAYS; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = formatDate(d);

      const raceIds = await discoverRaceIdsByDate(dateStr);
      if (raceIds.length === 0) continue;

      console.log(`[info] ${dateStr}: ${raceIds.length}レースを確認`);
      const summaries = await syncShutuba(raceIds);
      totalRacesCreated += summaries.filter((s) => s.raceCreated).length;
      totalEntriesInserted += summaries.reduce((sum, s) => sum + s.entriesInserted, 0);
      totalFailed += summaries.filter(
        (s) => s.status !== "ok" && s.status !== "skipped_excluded_class",
      ).length;
    }

    console.log(
      `\n合計races新規作成=${totalRacesCreated}件、race_entries作成=${totalEntriesInserted}件、失敗=${totalFailed}件`,
    );
    await finishPipelineRun(supabase, runId, "success");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishPipelineRun(supabase, runId, "failed", message);
    throw err;
  }
}

main().catch((err) => {
  console.error("[netkeiba] 出馬表ウォッチが予期せず失敗しました:", err);
  process.exit(1);
});
