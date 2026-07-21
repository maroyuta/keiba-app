import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RaceRank } from "@/lib/supabase/database.types";
import { RoiTimeSeriesChart, type PeriodStat } from "./RoiTimeSeriesChart";
import { RecommendationList, type RecommendationRow } from "./RecommendationList";
import { BreakdownTable, type BreakdownGroup, type BreakdownStat } from "./BreakdownTable";
import { PipelineStatusBanner, type PipelineRunSummary } from "./PipelineStatusBanner";

const BET_TYPE_LABELS: Record<string, string> = {
  wide: "ワイド",
  umaren: "馬連",
  both: "ワイド・馬連",
};

// ISO週の月曜日を週の代表日にする (日曜始まりだと月をまたいだ集計がずれやすいため)
function startOfIsoWeek(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const day = date.getUTCDay() || 7; // 日曜(0)を7として扱う
  if (day !== 1) {
    date.setUTCDate(date.getUTCDate() - (day - 1));
  }
  return date.toISOString().slice(0, 10);
}

function roiPct(stakeYen: number, returnYen: number): number {
  return stakeYen > 0 ? (returnYen / stakeYen) * 100 : 0;
}

function buildPeriodStats(
  rows: Array<{ label: string; stakeYen: number; returnYen: number }>,
): PeriodStat[] {
  const byLabel = new Map<string, { stakeYen: number; returnYen: number; count: number }>();
  for (const row of rows) {
    const bucket = byLabel.get(row.label) ?? { stakeYen: 0, returnYen: 0, count: 0 };
    bucket.stakeYen += row.stakeYen;
    bucket.returnYen += row.returnYen;
    bucket.count += 1;
    byLabel.set(row.label, bucket);
  }
  return [...byLabel.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, bucket]) => ({
      label,
      stakeYen: bucket.stakeYen,
      returnYen: bucket.returnYen,
      roiPct: roiPct(bucket.stakeYen, bucket.returnYen),
      count: bucket.count,
    }));
}

// netkeiba「My収支」の項目別テーブル (回収率/的中率/購入金額/払戻金額/購入R数/的中R数) と同じ形式で集計する
function buildBreakdownStats(
  rows: Array<{ label: string; stakeYen: number; returnYen: number; isHit: boolean | null }>,
): BreakdownStat[] {
  const byLabel = new Map<
    string,
    { stakeYen: number; returnYen: number; count: number; hitCount: number }
  >();
  for (const row of rows) {
    const bucket = byLabel.get(row.label) ?? { stakeYen: 0, returnYen: 0, count: 0, hitCount: 0 };
    bucket.stakeYen += row.stakeYen;
    bucket.returnYen += row.returnYen;
    bucket.count += 1;
    if (row.isHit) bucket.hitCount += 1;
    byLabel.set(row.label, bucket);
  }
  return [...byLabel.entries()]
    .map(([label, bucket]) => ({
      label,
      roiPct: roiPct(bucket.stakeYen, bucket.returnYen),
      hitRatePct: bucket.count > 0 ? (bucket.hitCount / bucket.count) * 100 : 0,
      stakeYen: bucket.stakeYen,
      returnYen: bucket.returnYen,
      count: bucket.count,
      hitCount: bucket.hitCount,
    }))
    .sort((a, b) => b.stakeYen - a.stakeYen); // netkeibaと同じく購入金額の多い順
}

export default async function DashboardPage() {
  const supabase = createAdminClient();

  // 3ジョブぶんの最新状態が拾えれば十分なので直近30件だけ見る (各ジョブは週1回しか走らないため)
  const { data: pipelineRunRows } = await supabase
    .from("pipeline_runs")
    .select("job_name, status, started_at, finished_at, error_message")
    .order("started_at", { ascending: false })
    .limit(30);

  const pipelineRuns: PipelineRunSummary[] = (pipelineRunRows ?? []).map((r) => ({
    jobName: r.job_name as PipelineRunSummary["jobName"],
    status: r.status as PipelineRunSummary["status"],
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    errorMessage: r.error_message,
  }));

  const { data: results } = await supabase
    .from("race_recommendation_results")
    .select(
      "*, races(race_date, keibajo_name, race_number, race_name, race_rank_reason)",
    )
    .not("computed_at", "is", null)
    .order("computed_at", { ascending: false });

  // これより前(バックテスト・検証用のバッチ)は集計対象から除外する。実運用の成績のみを
  // 見たいという要望(2026-07-15)を受けた設定で、元データ自体は消していないため、
  // 過去の検証結果はSupabase側に残ったまま参照できる(この定数を変えれば見え方も変わる)。
  const LIVE_TRACKING_START_DATE = "2026-07-18";

  const settled = (results ?? []).filter(
    (r): r is typeof r & { races: NonNullable<typeof r.races>; stake_yen: number } =>
      r.races !== null &&
      r.stake_yen !== null &&
      r.stake_yen > 0 &&
      r.races.race_date >= LIVE_TRACKING_START_DATE,
  );

  const totalStake = settled.reduce((sum, r) => sum + r.stake_yen, 0);
  const totalReturn = settled.reduce((sum, r) => sum + (r.return_yen ?? 0), 0);
  const overallRoi = roiPct(totalStake, totalReturn);
  const hitCount = settled.filter((r) => r.is_hit).length;
  const hitRate = settled.length > 0 ? (hitCount / settled.length) * 100 : 0;

  const weekStats = buildPeriodStats(
    settled.map((r) => ({
      label: startOfIsoWeek(r.races.race_date),
      stakeYen: r.stake_yen,
      returnYen: r.return_yen ?? 0,
    })),
  );
  const monthStats = buildPeriodStats(
    settled.map((r) => ({
      label: r.races.race_date.slice(0, 7),
      stakeYen: r.stake_yen,
      returnYen: r.return_yen ?? 0,
    })),
  );
  const yearStats = buildPeriodStats(
    settled.map((r) => ({
      label: r.races.race_date.slice(0, 4),
      stakeYen: r.stake_yen,
      returnYen: r.return_yen ?? 0,
    })),
  );

  const breakdownGroups: BreakdownGroup[] = [
    {
      key: "rank",
      label: "ランク別",
      stats: buildBreakdownStats(
        settled.map((r) => ({
          label: r.race_rank ?? "不明",
          stakeYen: r.stake_yen,
          returnYen: r.return_yen ?? 0,
          isHit: r.is_hit,
        })),
      ),
    },
    {
      key: "track",
      label: "競馬場別",
      stats: buildBreakdownStats(
        settled.map((r) => ({
          label: r.races.keibajo_name ?? "不明",
          stakeYen: r.stake_yen,
          returnYen: r.return_yen ?? 0,
          isHit: r.is_hit,
        })),
      ),
    },
    {
      key: "bet_type",
      label: "買い方別",
      stats: buildBreakdownStats(
        settled.map((r) => ({
          label: (r.bet_type && BET_TYPE_LABELS[r.bet_type]) ?? "不明",
          stakeYen: r.stake_yen,
          returnYen: r.return_yen ?? 0,
          isHit: r.is_hit,
        })),
      ),
    },
  ];

  const listRows: RecommendationRow[] = settled.map((r) => ({
    id: r.race_id,
    raceDate: r.races.race_date,
    keibajoName: r.races.keibajo_name,
    raceNumber: r.races.race_number,
    raceName: r.races.race_name,
    raceRank: r.race_rank as RaceRank | null,
    raceRankReason: r.races.race_rank_reason,
    honmeiHorseNumber: r.honmei_horse_number,
    aiteHorseNumber: r.aite_horse_number,
    aiteHorseNumber2: r.aite_horse_number_2,
    betType: r.bet_type,
    stakeYen: r.stake_yen,
    isHit: r.is_hit,
    returnYen: r.return_yen,
    roiPct: r.roi_pct,
  }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">回収率ダッシュボード</h1>
          <p className="text-xs text-zinc-500">
            {LIVE_TRACKING_START_DATE}以降(実運用分)を集計。それ以前のバックテストは含みません
          </p>
        </div>
        <Link
          href="/races"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          レース一覧
        </Link>
      </div>

      <PipelineStatusBanner runs={pipelineRuns} />

      {settled.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          確定した推奨結果がまだありません。レースが確定し、実際の配当と診断結果を突き合わせる集計バッチが動くとここに表示されます。
        </p>
      ) : (
        <>
          {/* 大まか: サマリーカード */}
          <section className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">総合回収率</p>
              <p
                className={`mt-1 text-xl font-bold ${overallRoi >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}
              >
                {overallRoi.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">的中率</p>
              <p className="mt-1 text-xl font-bold">{hitRate.toFixed(1)}%</p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">購入レース数</p>
              <p className="mt-1 text-xl font-bold">{settled.length}</p>
            </div>
          </section>

          {/* 大まか〜細かい: 期間別の推移 (週/月/年切り替え) */}
          <RoiTimeSeriesChart week={weekStats} month={monthStats} year={yearStats} />

          {/* netkeiba「My収支」の項目別テーブルと同じ形式: ランク別/競馬場別/買い方別をタブで切り替え */}
          <BreakdownTable groups={breakdownGroups} />

          {/* 細かい: 個別レースの一覧 (的中/外れで絞り込み、外れパターンの振り返り用) */}
          <RecommendationList rows={listRows} />
        </>
      )}
    </div>
  );
}
