import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RaceRank } from "@/lib/supabase/database.types";
import { RankBadge } from "./RankBadge";

type Race = {
  id: string;
  keibajo_code: string;
  keibajo_name: string | null;
  kaiji: number | null;
  nichiji: number | null;
  race_number: number;
  race_date: string;
  post_time: string | null;
  race_name: string | null;
  grade: string | null;
  race_class: string | null;
  track_type: string;
  distance_m: number;
  weather: string | null;
  track_condition: string | null;
  entry_count: number | null;
  race_rank: string | null;
};

function formatPostTime(postTime: string | null): string {
  return postTime ? postTime.slice(0, 5) : "--:--";
}

async function findAdjacentDate(
  supabase: ReturnType<typeof createAdminClient>,
  currentDate: string,
  direction: "prev" | "next",
): Promise<string | null> {
  const query = supabase
    .from("races")
    .select("race_date")
    .order("race_date", { ascending: direction === "next" })
    .limit(1);

  const { data } =
    direction === "prev"
      ? await query.lt("race_date", currentDate)
      : await query.gt("race_date", currentDate);

  return data?.[0]?.race_date ?? null;
}

export default async function RacesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const supabase = createAdminClient();

  let targetDate = date ?? null;
  if (!targetDate) {
    const { data: latest } = await supabase
      .from("races")
      .select("race_date")
      .order("race_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    targetDate = latest?.race_date ?? new Date().toISOString().slice(0, 10);
  }

  const { data: races } = await supabase
    .from("races")
    .select(
      "id, keibajo_code, keibajo_name, kaiji, nichiji, race_number, race_date, post_time, race_name, grade, race_class, track_type, distance_m, weather, track_condition, entry_count, race_rank",
    )
    .eq("race_date", targetDate)
    .order("keibajo_code", { ascending: true })
    .order("race_number", { ascending: true });

  const rows = (races ?? []) as Race[];

  const venueGroups = new Map<string, Race[]>();
  for (const race of rows) {
    const key = race.keibajo_code;
    if (!venueGroups.has(key)) venueGroups.set(key, []);
    venueGroups.get(key)!.push(race);
  }

  const [prevDate, nextDate] = await Promise.all([
    findAdjacentDate(supabase, targetDate, "prev"),
    findAdjacentDate(supabase, targetDate, "next"),
  ]);

  const dateLabel = new Date(`${targetDate}T00:00:00Z`).toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        <h1 className="text-xl font-bold text-white">レース一覧</h1>

        <div className="flex items-center justify-between gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
          {prevDate ? (
            <Link
              href={`/races?date=${prevDate}`}
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-400"
            >
              ← 前日
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm font-medium text-emerald-400/90">{dateLabel}</span>
          {nextDate ? (
            <Link
              href={`/races?date=${nextDate}`}
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-400"
            >
              次 →
            </Link>
          ) : (
            <span />
          )}
        </div>

        {venueGroups.size === 0 ? (
          <p className="text-sm text-zinc-500">この日のレースは登録されていません。</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...venueGroups.values()].map((venueRaces) => {
              const first = venueRaces[0];
              return (
                <section
                  key={first.keibajo_code}
                  className="flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40"
                >
                  <header className="flex flex-col gap-0.5 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2.5">
                    <span className="text-sm font-bold text-white">
                      {first.kaiji}回{first.keibajo_name}
                      {first.nichiji}日目
                    </span>
                    <span className="text-xs text-zinc-500">
                      {first.weather && `天候:${first.weather}`}
                      {first.track_condition && ` ・ 馬場:${first.track_condition}`}
                    </span>
                  </header>
                  <ul className="flex flex-col divide-y divide-zinc-800/80">
                    {venueRaces.map((race) => (
                      <li key={race.id}>
                        <Link
                          href={`/races/${race.id}`}
                          className="flex items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-emerald-500/5"
                        >
                          <span className="w-7 shrink-0 text-center text-xs font-bold text-zinc-500">
                            {race.race_number}R
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="flex items-center gap-1.5 truncate text-sm font-medium text-zinc-100">
                              {race.grade && (
                                <span className="shrink-0 rounded bg-amber-400/15 px-1 text-[10px] font-bold text-amber-400">
                                  {race.grade}
                                </span>
                              )}
                              <span className="truncate">
                                {race.race_name || race.race_class || "—"}
                              </span>
                            </span>
                            <span className="text-xs text-emerald-400/80">
                              {formatPostTime(race.post_time)} ・ {race.track_type}
                              {race.distance_m}m
                              {race.entry_count ? ` ・ ${race.entry_count}頭` : ""}
                            </span>
                          </div>
                          <RankBadge rank={race.race_rank as RaceRank | null} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
