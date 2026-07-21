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
  premium_diagnosed_at: string | null;
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

// 他の競馬サイト(netkeiba等)の並びに合わせるための開催場の表示順。
// ここに無い開催場コードは末尾にkeibajo_code昇順で並ぶ。
const VENUE_DISPLAY_ORDER = ["03", "10", "02"]; // 福島, 小倉, 函館

function groupByVenue(rows: Race[]): Race[][] {
  const venueGroups = new Map<string, Race[]>();
  for (const race of rows) {
    const key = race.keibajo_code;
    if (!venueGroups.has(key)) venueGroups.set(key, []);
    venueGroups.get(key)!.push(race);
  }
  return [...venueGroups.values()].sort((a, b) => {
    const codeA = a[0].keibajo_code;
    const codeB = b[0].keibajo_code;
    const rankA = VENUE_DISPLAY_ORDER.indexOf(codeA);
    const rankB = VENUE_DISPLAY_ORDER.indexOf(codeB);
    if (rankA !== -1 || rankB !== -1) {
      return (rankA === -1 ? 999 : rankA) - (rankB === -1 ? 999 : rankB);
    }
    return codeA.localeCompare(codeB);
  });
}

// レースを開催場(x軸)×レース番号1-12(y軸)のグリッドで俯瞰する。
// screening(Haiku)でC評価になったレースは弾かれたことが一目で分かるようにする。
const CELL_STYLES: Record<string, string> = {
  S: "border-[#ff9f1c]/60 bg-[#ff9f1c]/10 hover:bg-[#ff9f1c]/20",
  A: "border-teal-400/45 bg-teal-400/10 hover:bg-teal-400/20",
  B: "border-[#f2efe6]/20 bg-[#f2efe6]/[0.05] hover:bg-[#f2efe6]/10",
  C: "border-[#f2efe6]/8 bg-[#f2efe6]/[0.02] opacity-50 hover:opacity-75",
  none:
    "border-[#f2efe6]/10 bg-[#12241f] hover:border-[#ff9f1c]/40 hover:bg-[#ff9f1c]/5",
};

function RaceCell({ race }: { race: Race | undefined }) {
  if (!race) {
    return <div className="h-16 rounded-lg border border-dashed border-[#f2efe6]/10" />;
  }
  const styleKey = race.race_rank ?? "none";
  return (
    <Link
      href={`/races/${race.id}`}
      className={`flex h-16 flex-col justify-between overflow-hidden rounded-lg border px-1.5 py-1 transition-colors ${
        CELL_STYLES[styleKey] ?? CELL_STYLES.none
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        {race.grade ? (
          <span className="shrink-0 rounded bg-[#ff9f1c]/20 px-1 text-[8px] font-bold text-[#ff9f1c]">
            {race.grade}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          {race.premium_diagnosed_at && (
            <span
              title="本気診断済"
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
            />
          )}
          <RankBadge rank={race.race_rank as RaceRank | null} />
        </div>
      </div>
      <span className="truncate text-[11px] leading-tight font-medium text-[#f2efe6]">
        {race.race_name || race.race_class || "—"}
      </span>
      <span className="truncate font-mono text-[10px] leading-tight text-[#f2efe6]/45">
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
        className="grid min-w-max gap-1.5"
        style={{ gridTemplateColumns: `2.25rem repeat(${venueGroupsList.length}, 6.5rem)` }}
      >
        <div />
        {venueGroupsList.map((venueRaces) => {
          const first = venueRaces[0];
          return (
            <div key={first.keibajo_code} className="px-1 pb-1 text-center">
              <div className="text-[13px] font-bold text-[#f2efe6]">{first.keibajo_name}</div>
              <div className="text-[9px] text-[#f2efe6]/40">
                {first.track_condition ? `馬場:${first.track_condition}` : ""}
              </div>
            </div>
          );
        })}

        {raceNumbers.map((num) => (
          <div key={num} className="contents">
            <div className="flex items-center justify-center font-mono text-[11px] font-bold text-[#f2efe6]/45">
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
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#f2efe6]/45">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#ff9f1c]" />S
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-teal-400" />A
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#f2efe6]/40" />B
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#f2efe6]/15" />
          C(screening除外)
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />
          本気診断済
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
        "id, keibajo_code, keibajo_name, kaiji, nichiji, race_number, race_date, post_time, race_name, grade, race_class, track_type, distance_m, weather, track_condition, entry_count, race_rank, premium_diagnosed_at",
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
            "id, keibajo_code, keibajo_name, kaiji, nichiji, race_number, race_date, post_time, race_name, grade, race_class, track_type, distance_m, weather, track_condition, entry_count, race_rank, premium_diagnosed_at",
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
      <div className="min-h-screen bg-[#0b1a17] bg-[radial-gradient(circle_at_20%_0%,rgba(255,159,28,0.08),transparent_45%)] text-[#f2efe6]">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-bold text-[#f2efe6]">
              {usingFallback ? "直近のレース" : "今週のレース"}
            </h1>
            <span className="text-xs text-[#f2efe6]/45">単日ごとに見る場合は各日付見出しをタップ</span>
          </div>

          {dateGroups.size === 0 ? (
            <p className="text-sm text-[#f2efe6]/45">登録されているレースがありません。</p>
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
                    className="inline-flex w-fit items-center gap-1.5 border-b border-[#ff9f1c]/40 pb-1 text-sm font-semibold text-[#ff9f1c] transition-colors hover:text-[#ffb44d]"
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
      "id, keibajo_code, keibajo_name, kaiji, nichiji, race_number, race_date, post_time, race_name, grade, race_class, track_type, distance_m, weather, track_condition, entry_count, race_rank, premium_diagnosed_at",
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
    <div className="min-h-screen bg-[#0b1a17] bg-[radial-gradient(circle_at_20%_0%,rgba(255,159,28,0.08),transparent_45%)] text-[#f2efe6]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-[#f2efe6]">レース一覧</h1>
          <Link href="/races" className="text-xs text-[#ff9f1c] hover:text-[#ffb44d]">
            ← 今週まとめて見る
          </Link>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#f2efe6]/10 bg-[#12241f] px-3 py-2">
          {prevDate ? (
            <Link
              href={`/races?date=${prevDate}`}
              className="rounded-full border border-[#f2efe6]/18 px-3 py-1.5 text-sm text-[#f2efe6]/70 transition-colors hover:border-[#ff9f1c]/50 hover:text-[#ff9f1c]"
            >
              ← 前日
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm font-medium text-[#ff9f1c]">{dateLabel}</span>
          {nextDate ? (
            <Link
              href={`/races?date=${nextDate}`}
              className="rounded-full border border-[#f2efe6]/18 px-3 py-1.5 text-sm text-[#f2efe6]/70 transition-colors hover:border-[#ff9f1c]/50 hover:text-[#ff9f1c]"
            >
              次 →
            </Link>
          ) : (
            <span />
          )}
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-[#f2efe6]/45">この日のレースは登録されていません。</p>
        ) : (
          <DateGrid dateRows={rows} />
        )}
      </div>
    </div>
  );
}
