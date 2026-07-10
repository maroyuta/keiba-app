"use client";

import { useState } from "react";

export interface PeriodStat {
  label: string; // 週=月曜日(YYYY-MM-DD) / 月=YYYY-MM / 年=YYYY
  stakeYen: number;
  returnYen: number;
  roiPct: number;
  count: number;
}

type Granularity = "week" | "month" | "year";

const GRANULARITY_LABELS: Record<Granularity, string> = {
  week: "週",
  month: "月",
  year: "年",
};

// 直近が見切れないよう、細かい粒度ほど多めの本数を出す
const MAX_BARS: Record<Granularity, number> = {
  week: 12,
  month: 12,
  year: 5,
};

function formatLabel(granularity: Granularity, label: string): string {
  if (granularity === "year") return label;
  if (granularity === "month") return label.slice(5); // "MM"
  return label.slice(5); // 週は月曜日の"MM-DD"
}

export function RoiTimeSeriesChart({
  week,
  month,
  year,
}: {
  week: PeriodStat[];
  month: PeriodStat[];
  year: PeriodStat[];
}) {
  // 初めから細かいと見にくいので、デフォルトは月次 (大まか寄り)
  const [granularity, setGranularity] = useState<Granularity>("month");

  const bySource: Record<Granularity, PeriodStat[]> = { week, month, year };
  const all = bySource[granularity];
  const data = all.slice(-MAX_BARS[granularity]);

  const width = 560;
  const height = 180;
  const padTop = 16;
  const padBottom = 24;
  const padLeft = 8;
  const padRight = 8;
  const chartHeight = height - padTop - padBottom;

  const maxRoi = Math.max(100, ...data.map((d) => d.roiPct), 10);
  const barWidth = data.length > 0 ? (width - padLeft - padRight) / data.length : 0;
  const zeroY = padTop + chartHeight; // roi=0の位置
  const breakEvenY = padTop + chartHeight * (1 - 100 / maxRoi); // roi=100%の位置

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          期間別の回収率推移
        </h2>
        <div className="flex gap-1 rounded-full bg-zinc-100 p-0.5 text-xs dark:bg-zinc-800">
          {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={`rounded-full px-3 py-1 font-medium transition-colors ${
                granularity === g
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {GRANULARITY_LABELS[g]}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">この粒度のデータはまだありません。</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img">
          <title>{GRANULARITY_LABELS[granularity]}ごとの回収率推移</title>
          {/* 損益分岐線 (回収率100%) */}
          <line
            x1={padLeft}
            x2={width - padRight}
            y1={breakEvenY}
            y2={breakEvenY}
            stroke="currentColor"
            strokeDasharray="3 3"
            strokeWidth={1}
            className="text-zinc-300 dark:text-zinc-700"
          />
          {data.map((d, i) => {
            const barHeight = Math.abs(chartHeight * (d.roiPct / maxRoi));
            const y = d.roiPct >= 0 ? zeroY - barHeight : zeroY;
            const x = padLeft + i * barWidth;
            const isProfit = d.roiPct >= 100;
            return (
              <g key={d.label}>
                <rect
                  x={x + barWidth * 0.15}
                  y={y}
                  width={barWidth * 0.7}
                  height={Math.max(1, barHeight)}
                  rx={2}
                  className={isProfit ? "fill-emerald-500" : "fill-red-400"}
                />
                <text
                  x={x + barWidth / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-zinc-500 text-[9px] dark:fill-zinc-400"
                >
                  {formatLabel(granularity, d.label)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </section>
  );
}
