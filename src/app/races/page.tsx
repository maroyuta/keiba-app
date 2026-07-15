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

function groupByVenue(rows: Race[]): Race[][] {
  const venueGroups = new Map<string, Race[]>();
  for (const race of rows) {
    const key = race.keibajo_code;
    if (!venueGroups.has(key)) venueGroups.set(key, []);
    venueGroups.get(key)!.push(race);
  }
  return [...venueGroups.values()];
}

// レースを開催場(x軸)×レース番号1-12(y軸)のグリッドで俯瞰する。
// screening(Haiku)でC評価になったレースは鼠色で弾かれたことが一目で分かるようにする。
const CELL_STYLES: Record<string, string> = {
  S: "border-amber-400/50 bg-amber-400/10 hover:bg-amber-400/20",
  A: "border-teal-500/50 bg-teal-500/10 hover:bg-teal-500/20",
  B: "border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20",
  C: "border-zinc-300 bg-zinc-100 opacity-60 hover:opacity-80",
  none: "border-zinc-200 bg-zinc-50 hover:border-emerald-500/40 hover:bg-emerald-500/5",
};

function RaceCell({ race }: { race: Race | undefined }) {
  if (!race) {
    return <div className="h-12 rounded-lg border border-dashed border-zinc-300" />;
  }
  const styleKey = race.race_rank ?? "none";
  return (
    <Link
      href={`/races/${race.id}`}
      className={`flex h-12 flex-col justify-between overflow-hidden rounded-lg border px-1 py-0.5 transition-colors ${
        CELL_STYLES[styleKey] ?? CELL_STYLES.none
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        {race.grade ? (
          <span className="shrink-0 rounded bg-amber-400/20 px-0.5 text-[7px] font-bold text-amber-400">
            {race.grade}
          </span>
        ) : (
          <span />
        )}
        <RankBadge rank={race.race_rank as RaceRank | null} />
      </div>
      <span className="truncate text-[9px] leading-tight font-medium text-zinc-900">
        {race.race_name || race.race_class || "—"}
      </span>
      <span className="truncate text-[8px] leading-tight text-zinc-500">
        {formatPostTime(race.post_time)} {race.entry_count ? `${race.entry_count}頭` : ""}
      </span>
    </Link>
  );
}

function DateGrid({ dateRows }: { dateRows: Race[] }) {
  const venueGroupsList = groupByVenue(dateRows);
  const maxRaceNumber = Math.max(12, ...dateRows.map((r) => r.race_number));
  const raceNumbers = Array.from({ length: maxRaceNumber }, (_, i) => i + 1);

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-max gap-1"
        style={{ gridTemplateColumns: `1.75rem repeat(${venueGroupsList.length}, 5.5rem)` }}
      >
        <div />
        {venueGroupsList.map((venueRaces) => {
          const first = venueRaces[0];
          return (
            <div key={first.keibajo_code} className="px-1 pb-1 text-center">
              <div className="text-[11px] font-bold text-zinc-900">{first.keibajo_name}</div>
              <div className="text-[8px] text-zinc-500">
                {first.track_condition ? `馬場:${first.track_condition}` : ""}
              </div>
            </div>
          );
        })}

        {raceNumbers.map((num) => (
          <div key={num} className="contents">
            <div className="flex items-center justify-center text-[10px] font-bold text-zinc-500">
              {num}R
            </div>
            {venueGroupsList.map((venueRaces) => (
              <RaceCell
                key={`${venueRaces[0].keibajo_code}-${num}`}
                race={venueRaces.find((r) => r.race_number === num)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />S
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-teal-500" />A
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />B
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-600" />C(screening除外)
        </span>
      </div>
    </div>
  );
}

export default async function RacesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const supabase = createAdminClient();

  // dateが明示されていない場合は「今週まとめて見る」ビュー: 今日以降に登録されている
  // 全開催日を1ページにまとめて表示する(週末2日分をいちいち日付切り替えせず俯瞰したいという要望)。
  // dateが指定された場合は従来通り単日ドリルダウン(過去日の閲覧・前日/次日ナビゲーション用)。
  if (!date) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: upcoming } = await supabase
      .from("races")
      .select(
        "id, keibajo_code, keibajo_name, kaiji, nichiji, race_number, race_date, post_time, race_name, grade, race_class, track_type, distance_m, weather, track_condition, entry_count, race_rank",
      )
      .gte("race_date", today)
      .order("race_date", { ascending: true })
      .order("keibajo_code", { ascending: true })
      .order("race_number", { ascending: true });

    let rows = (upcoming ?? []) as Race[];
    let usingFallback = false;

    // 今日以降のレースが1件も無い場合(開催と開催の谷間等)は、直近の過去開催を表示する
    if (rows.length === 0) {
      const { data: latest } = await supabase
        .from("races")
        .select("race_date")
        .order("race_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest?.race_date) {
        const { data: fallback } = await supabase
          .from("races")
          .select(
            "id, keibajo_code, keibajo_name, kaiji, nichiji, race_number, race_date, post_time, race_name, grade, race_class, track_type, distance_m, weather, track_condition, entry_count, race_rank",
          )
          .eq("race_date", latest.race_date)
          .order("keibajo_code", { ascending: true })
          .order("race_number", { ascending: true });
        rows = (fallback ?? []) as Race[];
        usingFallback = true;
      }
    }

    const dateGroups = new Map<string, Race[]>();
    for (const race of rows) {
      if (!dateGroups.has(race.race_date)) dateGroups.set(race.race_date, []);
      dateGroups.get(race.race_date)!.push(race);
    }

    return (
      <div className="min-h-screen bg-white text-zinc-900">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-bold text-zinc-900">
              {usingFallback ? "直近のレース" : "今週のレース"}
            </h1>
            <span className="text-xs text-zinc-500">単日ごとに見る場合は各日付見出しをタップ</span>
          </div>

          {dateGroups.size === 0 ? (
            <p className="text-sm text-zinc-500">登録されているレースがありません。</p>
          ) : (
            [...dateGroups.entries()].map(([raceDate, dateRows]) => {
              const dateLabel = new Date(`${raceDate}T00:00:00Z`).toLocaleDateString("ja-JP", {
                month: "long",
                day: "numeric",
                weekday: "short",
                timeZone: "UTC",
              });
              return (
                <div key={raceDate} className="flex flex-col gap-3">
                  <Link
                    href={`/races?date=${raceDate}`}
                    className="inline-flex w-fit items-center gap-1.5 border-b border-emerald-500/30 pb-1 text-sm font-semibold text-emerald-600 transition-colors hover:text-emerald-700"
                  >
                    {dateLabel}
                  </Link>
                  <DateGrid dateRows={dateRows} />
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  const targetDate = date;

  const { data: races } = await supabase
    .from("races")
    .select(
      "id, keibajo_code, keibajo_name, kaiji, nichiji, race_number, race_date, post_time, race_name, grade, race_class, track_type, distance_m, weather, track_condition, entry_count, race_rank",
    )
    .eq("race_date", targetDate)
    .order("keibajo_code", { ascending: true })
    .order("race_number", { ascending: true });

  const rows = (races ?? []) as Race[];

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
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-zinc-900">レース一覧</h1>
          <Link href="/races" className="text-xs text-emerald-600 hover:text-emerald-700">
            ← 今週まとめて見る
          </Link>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2">
          {prevDate ? (
            <Link
              href={`/races?date=${prevDate}`}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:border-emerald-500/50 hover:text-emerald-600"
            >
              ← 前日
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm font-medium text-emerald-600">{dateLabel}</span>
          {nextDate ? (
            <Link
              href={`/races?date=${nextDate}`}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:border-emerald-500/50 hover:text-emerald-600"
            >
              次 →
            </Link>
          ) : (
            <span />
          )}
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">この日のレースは登録されていません。</p>
        ) : (
          <DateGrid dateRows={rows} />
        )}
      </div>
    </div>
  );
}
