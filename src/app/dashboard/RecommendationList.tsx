"use client";

import { useState } from "react";
import Link from "next/link";
import type { RaceRank } from "@/lib/supabase/database.types";
import { RankBadge } from "../races/RankBadge";

export interface RecommendationRow {
  id: string; // race_id
  raceDate: string;
  keibajoName: string | null;
  raceNumber: number;
  raceName: string | null;
  raceRank: RaceRank | null;
  raceRankReason: string | null;
  honmeiHorseNumber: number | null;
  aiteHorseNumber: number | null;
  aiteHorseNumber2: number | null;
  betType: string | null;
  stakeYen: number;
  isHit: boolean | null;
  returnYen: number | null;
  roiPct: number | null;
}

type Filter = "all" | "hit" | "miss";

const FILTER_LABELS: Record<Filter, string> = {
  all: "すべて",
  hit: "的中のみ",
  miss: "外れのみ",
};

export function RecommendationList({ rows }: { rows: RecommendationRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = rows.filter((r) => {
    if (filter === "hit") return r.isHit === true;
    if (filter === "miss") return r.isHit === false;
    return true;
  });

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          個別レース (振り返り用)
        </h2>
        <div className="flex gap-1 rounded-full bg-zinc-100 p-0.5 text-xs dark:bg-zinc-800">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 font-medium transition-colors ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">該当するレースがありません。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <Link
                href={`/races/${r.id}`}
                className="flex flex-col gap-1 rounded-lg p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <RankBadge rank={r.raceRank} />
                    <span className="text-sm font-medium">
                      {r.raceDate} {r.keibajoName}
                      {r.raceNumber}R {r.raceName}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.isHit
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                        : "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"
                    }`}
                  >
                    {r.isHit ? "的中" : "外れ"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>
                    {r.honmeiHorseNumber}
                    {r.aiteHorseNumber && ` → ${r.aiteHorseNumber}`}
                    {r.aiteHorseNumber2 && `・${r.aiteHorseNumber2}`}
                  </span>
                  <span>投資 {r.stakeYen.toLocaleString()}円</span>
                  <span>払戻 {(r.returnYen ?? 0).toLocaleString()}円</span>
                  <span
                    className={
                      (r.roiPct ?? 0) >= 100
                        ? "font-medium text-emerald-600 dark:text-emerald-400"
                        : "font-medium text-red-500"
                    }
                  >
                    回収率 {(r.roiPct ?? 0).toFixed(0)}%
                  </span>
                </div>
                {r.raceRankReason && (
                  <p className="line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {r.raceRankReason}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
