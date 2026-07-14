import type { PipelineJobName, PipelineRunStatus } from "@/lib/supabase/database.types";

export interface PipelineRunSummary {
  jobName: PipelineJobName;
  status: PipelineRunStatus;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

const JOB_LABELS: Record<PipelineJobName, string> = {
  jvlink_weekly_sync: "JV-Link同期",
  compute_recommendation_results: "回収率算出",
  sync_netkeiba_recent: "過去走同期",
  sync_netkeiba_shutuba: "出馬表先回り同期",
};

const JOB_ORDER: PipelineJobName[] = [
  "jvlink_weekly_sync",
  "compute_recommendation_results",
  "sync_netkeiba_recent",
  "sync_netkeiba_shutuba",
];

// 「running」のまま長時間放置されている行は、PCのシャットダウン等でプロセスが
// 異常終了しfinished_atが書き込まれなかった可能性が高い(正常な週次バッチは数分〜十数分で終わる)。
// この場合は「実行中」ではなく「不明(要確認)」として警告表示する。
const STALE_RUNNING_THRESHOLD_MS = 3 * 60 * 60 * 1000;

// 直接コンポーネント内でDate.now()を呼ぶとreact-hooks/purityに引っかかるため関数を分離する。
function isStaleRunning(startedAtIso: string): boolean {
  return Date.now() - new Date(startedAtIso).getTime() > STALE_RUNNING_THRESHOLD_MS;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusPill({ run }: { run: PipelineRunSummary | undefined }) {
  if (!run) {
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        記録なし
      </span>
    );
  }

  if (run.status === "running" && isStaleRunning(run.startedAt)) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        不明(要確認)・{formatDateTime(run.startedAt)}開始
      </span>
    );
  }
  if (run.status === "running") {
    return (
      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
        実行中・{formatDateTime(run.startedAt)}開始
      </span>
    );
  }
  if (run.status === "failed") {
    return (
      <span
        className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-300"
        title={run.errorMessage ?? undefined}
      >
        失敗・{formatDateTime(run.startedAt)}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
      成功・{run.finishedAt ? formatDateTime(run.finishedAt) : formatDateTime(run.startedAt)}
    </span>
  );
}

export function PipelineStatusBanner({ runs }: { runs: PipelineRunSummary[] }) {
  const latestByJob = new Map<PipelineJobName, PipelineRunSummary>();
  for (const run of runs) {
    if (!latestByJob.has(run.jobName)) {
      latestByJob.set(run.jobName, run);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">週次データ同期の状況</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
        {JOB_ORDER.map((jobName) => (
          <div key={jobName} className="flex items-center gap-2">
            <span className="text-zinc-700 dark:text-zinc-300">{JOB_LABELS[jobName]}</span>
            <StatusPill run={latestByJob.get(jobName)} />
          </div>
        ))}
      </div>
    </section>
  );
}
