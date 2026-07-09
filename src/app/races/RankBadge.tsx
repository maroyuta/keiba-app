import type { RaceRank } from "@/lib/supabase/database.types";

const RANK_BADGE_STYLES: Record<RaceRank, string> = {
  S: "bg-amber-400 text-amber-950 dark:bg-amber-400 dark:text-amber-950",
  A: "bg-emerald-500 text-white dark:bg-emerald-500",
  B: "bg-sky-500 text-white dark:bg-sky-500",
  C: "bg-zinc-400 text-white dark:bg-zinc-500",
};

export function RankBadge({ rank }: { rank: RaceRank | null }) {
  if (!rank) {
    return <span className="text-zinc-400 dark:text-zinc-500">—</span>;
  }
  return (
    <span
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${RANK_BADGE_STYLES[rank]}`}
    >
      {rank}
    </span>
  );
}
