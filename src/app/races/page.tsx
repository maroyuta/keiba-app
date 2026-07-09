import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RaceRank } from "@/lib/supabase/database.types";
import { RankBadge } from "./RankBadge";

export default async function RacesPage() {
  const supabase = createAdminClient();

  const { data: races } = await supabase
    .from("races")
    .select("*")
    .order("race_date", { ascending: false })
    .order("keibajo_code", { ascending: true })
    .order("race_number", { ascending: true })
    .limit(100);

  const rows = races ?? [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6">
      <h1 className="text-xl font-bold">レース一覧</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          レースがまだ登録されていません。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((race) => (
            <li key={race.id}>
              <Link
                href={`/races/${race.id}`}
                className="flex items-center justify-between gap-3 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {race.keibajo_name}
                    {race.race_number}R {race.race_name}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {race.race_date}
                    {race.track_type && ` ・ ${race.track_type}${race.distance_m}m`}
                  </span>
                </div>
                <RankBadge rank={race.race_rank as RaceRank | null} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
