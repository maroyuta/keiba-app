import type { RaceRank } from "@/lib/supabase/database.types";

const RANK_BADGE_STYLES: Record<RaceRank, string> = {
  S: "bg-emerald-400 text-emerald-950",
  A: "bg-teal-500 text-white",
  B: "bg-sky-500 text-white",
  C: "bg-zinc-600 text-zinc-100",
};

export function RankBadge({ rank }: { rank: RaceRank | null }) {
  if (!rank) {
    return <span className="text-zinc-500">—</span>;
  }
  return (
    <span
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${RANK_BADGE_STYLES[rank]}`}
    >
      {rank}
    </span>
  );
}
