"use client";

import { useState } from "react";

export interface BreakdownStat {
  label: string;
  roiPct: number;
  hitRatePct: number;
  stakeYen: number;
  returnYen: number;
  count: number;
  hitCount: number;
}

export interface BreakdownGroup {
  key: string;
  label: string;
  stats: BreakdownStat[];
}

function formatYen(yen: number): string {
  return `${yen.toLocaleString()}円`;
}

function Table({ stats }: { stats: BreakdownStat[] }) {
  if (stats.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">この区分のデータはまだありません。</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 pr-2 font-medium">項目</th>
            <th className="py-2 pr-2 text-right font-medium">回収率</th>
            <th className="py-2 pr-2 text-right font-medium">的中率</th>
            <th className="py-2 pr-2 text-right font-medium">購入金額</th>
            <th className="py-2 pr-2 text-right font-medium">払戻金額</th>
            <th className="py-2 pr-2 text-right font-medium">購入R数</th>
            <th className="py-2 text-right font-medium">的中R数</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr
              key={s.label}
              className="border-b border-zinc-100 dark:border-zinc-900"
            >
              <td className="py-2 pr-2 font-medium">{s.label}</td>
              <td
                className={`py-2 pr-2 text-right font-medium ${
                  s.roiPct >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"
                }`}
              >
                {s.roiPct.toFixed(1)}%
              </td>
              <td className="py-2 pr-2 text-right text-zinc-700 dark:text-zinc-300">
                {s.hitRatePct.toFixed(1)}%
              </td>
              <td className="py-2 pr-2 text-right text-zinc-700 dark:text-zinc-300">
                {formatYen(s.stakeYen)}
              </td>
              <td className="py-2 pr-2 text-right text-zinc-700 dark:text-zinc-300">
                {formatYen(s.returnYen)}
              </td>
              <td className="py-2 pr-2 text-right text-zinc-700 dark:text-zinc-300">{s.count}</td>
              <td className="py-2 text-right text-zinc-700 dark:text-zinc-300">{s.hitCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BreakdownTable({ groups }: { groups: BreakdownGroup[] }) {
  const [activeKey, setActiveKey] = useState(groups[0]?.key);
  const active = groups.find((g) => g.key === activeKey) ?? groups[0];

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">項目別の回収率</h2>
        <div className="flex gap-1 rounded-full bg-zinc-100 p-0.5 text-xs dark:bg-zinc-800">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setActiveKey(g.key)}
              className={`rounded-full px-3 py-1 font-medium transition-colors ${
                active?.key === g.key
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      {active && <Table stats={active.stats} />}
    </section>
  );
}
