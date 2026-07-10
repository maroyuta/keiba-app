import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RaceRank } from "@/lib/supabase/database.types";
import { RankBadge } from "../races/RankBadge";
import { RoiTimeSeriesChart, type PeriodStat } from "./RoiTimeSeriesChart";
import { RecommendationList, type RecommendationRow } from "./RecommendationList";

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

export default async function DashboardPage() {
  const supabase = createAdminClient();

  const { data: results } = await supabase
    .from("race_recommendation_results")
    .select(
      "*, races(race_date, keibajo_name, race_number, race_name, race_rank_reason)",
    )
    .not("computed_at", "is", null)
    .order("computed_at", { ascending: false });

  const settled = (results ?? []).filter(
    (r): r is typeof r & { races: NonNullable<typeof r.races>; stake_yen: number } =>
      r.races !== null && r.stake_yen !== null && r.stake_yen > 0,
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

  const RANKS: RaceRank[] = ["S", "A", "B", "C"];
  const rankStats = RANKS.map((rank) => {
    const rows = settled.filter((r) => r.race_rank === rank);
    const stakeYen = rows.reduce((sum, r) => sum + r.stake_yen, 0);
    const returnYen = rows.reduce((sum, r) => sum + (r.return_yen ?? 0), 0);
    return {
      rank,
      count: rows.length,
      stakeYen,
      returnYen,
      roiPct: roiPct(stakeYen, returnYen),
    };
  }).filter((r) => r.count > 0);

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
    betType: r.bet_type,
    stakeYen: r.stake_yen,
    isHit: r.is_hit,
    returnYen: r.return_yen,
    roiPct: r.roi_pct,
  }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">回収率ダッシュボード</h1>
        <Link
          href="/races"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          レース一覧
        </Link>
      </div>

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

          {/* 自信度 (S/A/B/C) ごとの回収率 */}
          {rankStats.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                自信度(ランク)別の回収率
              </h2>
              <div className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
                {rankStats.map((r) => (
                  <div key={r.rank} className="flex items-center gap-3 py-2">
                    <RankBadge rank={r.rank} />
                    <span className="w-16 text-xs text-zinc-500 dark:text-zinc-400">
                      {r.count}レース
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className={`h-full ${r.roiPct >= 100 ? "bg-emerald-500" : "bg-red-400"}`}
                        style={{ width: `${Math.min(100, r.roiPct)}%` }}
                      />
                    </div>
                    <span
                      className={`w-14 text-right text-sm font-medium ${r.roiPct >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}
                    >
                      {r.roiPct.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 細かい: 個別レースの一覧 (的中/外れで絞り込み、外れパターンの振り返り用) */}
          <RecommendationList rows={listRows} />
        </>
      )}
    </div>
  );
}
