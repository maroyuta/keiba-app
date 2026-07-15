import type { RaceRank } from "@/lib/supabase/database.types";

const RANK_BADGE_STYLES: Record<RaceRank, string> = {
  S: "bg-[#ff9f1c] text-[#0b1a17] shadow-[0_0_12px_rgba(255,159,28,0.5)]",
  A: "bg-teal-400/20 text-teal-300",
  B: "bg-[#f2efe6]/12 text-[#f2efe6]",
  C: "bg-[#f2efe6]/8 text-[#f2efe6]/45",
};

export function RankBadge({ rank }: { rank: RaceRank | null }) {
  if (!rank) {
    return <span className="text-[#f2efe6]/35">—</span>;
  }
  return (
    <span
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ${RANK_BADGE_STYLES[rank]}`}
    >
      {rank}
    </span>
  );
}
