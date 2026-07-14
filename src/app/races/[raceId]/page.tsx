import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RaceRank, BetType } from "@/lib/supabase/database.types";
import { RankBadge } from "../RankBadge";
import { WakuBadge } from "../WakuBadge";
import { DiagnoseButton } from "./DiagnoseButton";

const BET_TYPE_LABELS: Record<BetType, string> = {
  wide: "ワイド",
  umaren: "馬連",
  both: "ワイド・馬連",
};

const RANK_LEGEND: { rank: RaceRank; label: string }[] = [
  { rank: "S", label: "軸級" },
  { rank: "A", label: "相手本線" },
  { rank: "B", label: "押さえ" },
  { rank: "C", label: "軽視〜消し" },
];

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

  const buySection = race.honmei_horse_number && (
    <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5">
      <h2 className="text-xs font-semibold text-emerald-600">買い目</h2>
      <p className="mt-1 text-xl font-bold text-zinc-900">
        {race.honmei_horse_number}
        {race.aite_horse_number && (
          <span className="text-emerald-600"> → {race.aite_horse_number}</span>
        )}
        {race.bet_type && (
          <span className="ml-2 text-sm font-normal text-zinc-500">
            ({BET_TYPE_LABELS[race.bet_type as BetType]})
          </span>
        )}
      </p>
      {(race.bet_amount_wide || race.bet_amount_umaren) && (
        <p className="mt-1 text-sm text-zinc-300">
          {race.bet_amount_wide && `ワイド ${race.bet_amount_wide.toLocaleString()}円`}
          {race.bet_amount_wide && race.bet_amount_umaren && " / "}
          {race.bet_amount_umaren && `馬連 ${race.bet_amount_umaren.toLocaleString()}円`}
        </p>
      )}
    </section>
  );

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="relative flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
          <div className="absolute top-4 right-4">
            <RankBadge rank={race.race_rank as RaceRank | null} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs font-medium text-emerald-600">
            <span>{race.keibajo_name}</span>
            <span className="text-zinc-300">・</span>
            <span>
              {race.track_type}
              {race.distance_m}m
              {race.turn_direction && `(${race.turn_direction})`}
            </span>
            {race.race_class && (
              <>
                <span className="text-zinc-300">・</span>
                <span>{race.race_class}</span>
              </>
            )}
            {race.entry_count && (
              <>
                <span className="text-zinc-300">・</span>
                <span>{race.entry_count}頭</span>
              </>
            )}
            {(race.weather || race.track_condition) && (
              <>
                <span className="text-zinc-300">・</span>
                <span>
                  {race.weather}
                  {race.weather && race.track_condition && "/"}
                  {race.track_condition}
                </span>
              </>
            )}
          </div>

          <h1 className="text-center text-2xl font-bold text-zinc-900">
            {race.grade && <span className="mr-2 text-amber-400">{race.grade}</span>}
            {race.race_number}R {race.race_name || race.race_class || "—"}
          </h1>

          <div className="text-center text-xs text-zinc-500">
            {race.race_date}
            {race.post_time && ` ${race.post_time.slice(0, 5)}発走`}
          </div>

          {race.bias_note && (
            <p className="text-center text-sm text-zinc-300">
              <span className="text-zinc-500">トラックバイアス:</span> {race.bias_note}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-zinc-200 pt-3">
            {RANK_LEGEND.map(({ rank, label }) => (
              <span key={rank} className="flex items-center gap-1.5 text-xs text-zinc-500">
                <RankBadge rank={rank} />
                {label}
              </span>
            ))}
          </div>

          {race.race_rank_reason && (
            <p className="text-sm leading-relaxed text-zinc-300">{race.race_rank_reason}</p>
          )}

          <DiagnoseButton
            raceId={race.id}
            hasResult={race.race_rank !== null}
            raceRank={race.race_rank as RaceRank | null}
            raceClass={race.race_class}
            raceGrade={race.grade}
          />
        </header>

        {buySection}

        <section className="flex flex-col gap-2">
          {sortedEntries.map((entry) => {
            const isHonmei = entry.horse_number === race.honmei_horse_number;
            const isAite = entry.horse_number === race.aite_horse_number;
            const isDangerFavorite =
              entry.expected_popularity !== null &&
              entry.expected_popularity <= 5 &&
              (entry.horse_rank === "B" || entry.horse_rank === "C");

            return (
              <div
                key={entry.id}
                className={`flex items-start gap-3 rounded-xl border p-3 ${
                  isHonmei
                    ? "border-amber-400/70 bg-amber-400/10 ring-1 ring-amber-400/40"
                    : isAite
                      ? "border-emerald-400/70 bg-emerald-400/10 ring-1 ring-emerald-400/40"
                      : "border-zinc-200 bg-zinc-50"
                } ${entry.is_kesshi ? "opacity-50" : ""}`}
              >
                <WakuBadge waku={entry.post_position} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs text-zinc-500">{entry.horse_number}番</span>
                    <span className="truncate font-bold text-zinc-900">
                      {entry.horses.horse_name}
                    </span>
                    {isHonmei && (
                      <span className="rounded bg-amber-400 px-1 text-xs font-bold text-amber-950">
                        本命
                      </span>
                    )}
                    {isAite && (
                      <span className="rounded bg-emerald-400 px-1 text-xs font-bold text-emerald-950">
                        相手
                      </span>
                    )}
                    {entry.is_kesshi && (
                      <span className="rounded bg-red-500/20 px-1 text-xs font-medium text-red-400">
                        消
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <span>
                      {entry.expected_popularity ? `${entry.expected_popularity}人気` : "—"}
                      {entry.odds_win !== null && ` (${formatOdds(entry.odds_win)}倍)`}
                    </span>
                    {isDangerFavorite && (
                      <span className="rounded bg-red-500/20 px-1 text-[10px] font-medium text-red-400">
                        危険な人気馬
                      </span>
                    )}
                  </div>
                  {entry.horse_rank_comment && (
                    <p className="mt-1 text-sm leading-snug text-zinc-300">
                      {entry.horse_rank_comment}
                    </p>
                  )}
                </div>
                <RankBadge rank={entry.horse_rank as RaceRank | null} />
              </div>
            );
          })}
        </section>

        {analysisItems.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold text-zinc-500">全体分析</h2>
            <dl className="flex flex-col gap-2">
              {analysisItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"
                >
                  <dt className="text-xs font-medium text-emerald-600">{item.label}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-zinc-700">{item.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {buySection}
      </div>
    </div>
  );
}
