import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RaceRank, BetType } from "@/lib/supabase/database.types";
import { RankBadge } from "../RankBadge";
import { DiagnoseButton } from "./DiagnoseButton";

const BET_TYPE_LABELS: Record<BetType, string> = {
  wide: "ワイド",
  umaren: "馬連",
  both: "ワイド・馬連",
};

function formatOdds(odds: number | null): string {
  return odds === null ? "—" : odds.toFixed(1);
}

export default async function RaceDiagnosisPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  const supabase = createAdminClient();

  const { data: race } = await supabase.from("races").select("*").eq("id", raceId).single();
  if (!race) {
    notFound();
  }

  const { data: entries } = await supabase
    .from("race_entries")
    .select("*, horses(*)")
    .eq("race_id", raceId)
    .order("horse_number");

  const sortedEntries = entries ?? [];

  const analysisItems = [
    { label: "レース全体のレベル・層の厚さ", text: race.analysis_level },
    { label: "本命が堅い/危ない理由", text: race.analysis_favorite },
    { label: "相手の根拠", text: race.analysis_rival },
    { label: "妙味馬が出る理由", text: race.analysis_value },
    { label: "ペース・展開想定", text: race.analysis_pace },
  ].filter((item) => item.text);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold">
            {race.keibajo_name}
            {race.race_number}R {race.race_name}
          </h1>
          <RankBadge rank={race.race_rank as RaceRank | null} />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          <span>{race.race_date}</span>
          {race.grade && <span>{race.grade}</span>}
          {race.race_class && <span>{race.race_class}</span>}
          <span>
            {race.track_type}
            {race.distance_m}m
            {race.turn_direction && `(${race.turn_direction})`}
          </span>
          {race.track_condition && <span>馬場:{race.track_condition}</span>}
          {race.weather && <span>天候:{race.weather}</span>}
          {race.entry_count && <span>{race.entry_count}頭</span>}
        </div>
        {race.race_rank_reason && (
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {race.race_rank_reason}
          </p>
        )}
        {race.bias_note && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-medium text-zinc-500 dark:text-zinc-400">想定バイアス:</span>{" "}
            {race.bias_note}
          </p>
        )}
        <DiagnoseButton
          raceId={race.id}
          hasResult={race.race_rank !== null}
          raceRank={race.race_rank as RaceRank | null}
        />
      </header>

      {race.honmei_horse_number && (
        <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">買い目</h2>
          <p className="mt-1 text-lg font-bold">
            {race.honmei_horse_number}
            {race.aite_horse_number && ` → ${race.aite_horse_number}`}
            {race.bet_type && (
              <span className="ml-2 text-sm font-normal text-zinc-600 dark:text-zinc-400">
                ({BET_TYPE_LABELS[race.bet_type as BetType]})
              </span>
            )}
          </p>
          {(race.bet_amount_wide || race.bet_amount_umaren) && (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {race.bet_amount_wide && `ワイド ${race.bet_amount_wide}円`}
              {race.bet_amount_wide && race.bet_amount_umaren && " / "}
              {race.bet_amount_umaren && `馬連 ${race.bet_amount_umaren}円`}
            </p>
          )}
        </section>
      )}

      <section className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="py-2 pr-2 font-medium">枠</th>
              <th className="py-2 pr-2 font-medium">馬番</th>
              <th className="py-2 pr-2 font-medium">馬名</th>
              <th className="py-2 pr-2 font-medium">人気</th>
              <th className="py-2 pr-2 font-medium">ランク</th>
              <th className="py-2 font-medium">短評</th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry) => (
              <tr
                key={entry.id}
                className={`border-b border-zinc-100 align-top dark:border-zinc-900 ${
                  entry.is_kesshi ? "opacity-50" : ""
                }`}
              >
                <td className="py-2 pr-2">{entry.post_position}</td>
                <td className="py-2 pr-2 font-medium">{entry.horse_number}</td>
                <td className="py-2 pr-2">
                  {entry.horses.horse_name}
                  {entry.is_kesshi && (
                    <span className="ml-1 text-xs text-red-500">消</span>
                  )}
                </td>
                <td className="py-2 pr-2 text-zinc-500 dark:text-zinc-400">
                  {entry.expected_popularity ?? "—"}
                  {entry.odds_win !== null && (
                    <span className="ml-1 text-xs">({formatOdds(entry.odds_win)})</span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  <RankBadge rank={entry.horse_rank as RaceRank | null} />
                </td>
                <td className="py-2 text-zinc-700 dark:text-zinc-300">
                  {entry.horse_rank_comment ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {analysisItems.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">全体分析</h2>
          <dl className="flex flex-col gap-3">
            {analysisItems.map((item) => (
              <div key={item.label}>
                <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {item.label}
                </dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                  {item.text}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
