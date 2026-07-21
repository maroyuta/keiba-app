import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RaceRank, BetType } from "@/lib/supabase/database.types";
import { RankBadge } from "../RankBadge";
import { DiagnoseButton } from "./DiagnoseButton";
import { EntriesList } from "./EntriesList";
import { ReviewCheckbox } from "./ReviewCheckbox";

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
    { label: "ペース・展開想定", text: race.analysis_pace },
  ].filter((item) => item.text);

  const buySection = race.honmei_horse_number && (
    <section className="rounded-2xl border border-[#ff9f1c]/40 bg-[#ff9f1c]/10 p-5">
      <h2 className="text-xs font-semibold text-[#ff9f1c]">買い目</h2>
      <p className="mt-1 font-mono text-xl font-bold text-[#f2efe6]">
        {race.honmei_horse_number}
        {race.aite_horse_number && (
          <span className="text-[#ff9f1c]"> → {race.aite_horse_number}</span>
        )}
        {race.bet_type && (
          <span className="ml-2 font-sans text-sm font-normal text-[#f2efe6]/50">
            ({BET_TYPE_LABELS[race.bet_type as BetType]})
          </span>
        )}
      </p>
      {(race.bet_amount_wide || race.bet_amount_umaren) && (
        <p className="mt-1 text-sm text-[#f2efe6]/70">
          {race.bet_amount_wide && `ワイド ${race.bet_amount_wide.toLocaleString()}円`}
          {race.bet_amount_wide && race.bet_amount_umaren && " / "}
          {race.bet_amount_umaren && `馬連 ${race.bet_amount_umaren.toLocaleString()}円`}
        </p>
      )}
      {race.aite_horse_number_2 && (
        <>
          <p className="mt-3 font-mono text-xl font-bold text-[#f2efe6]">
            {race.honmei_horse_number}
            <span className="text-[#ff9f1c]"> → {race.aite_horse_number_2}</span>
            {race.bet_type && (
              <span className="ml-2 font-sans text-sm font-normal text-[#f2efe6]/50">
                ({BET_TYPE_LABELS[race.bet_type as BetType]})
              </span>
            )}
          </p>
          {(race.bet_amount_wide_2 || race.bet_amount_umaren_2) && (
            <p className="mt-1 text-sm text-[#f2efe6]/70">
              {race.bet_amount_wide_2 && `ワイド ${race.bet_amount_wide_2.toLocaleString()}円`}
              {race.bet_amount_wide_2 && race.bet_amount_umaren_2 && " / "}
              {race.bet_amount_umaren_2 && `馬連 ${race.bet_amount_umaren_2.toLocaleString()}円`}
            </p>
          )}
        </>
      )}
    </section>
  );

  return (
    <div className="min-h-screen bg-[#0b1a17] bg-[radial-gradient(circle_at_20%_0%,rgba(255,159,28,0.08),transparent_45%)] text-[#f2efe6]">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="relative flex flex-col gap-3 rounded-2xl border border-[#f2efe6]/10 bg-[#12241f] p-5">
          <div className="absolute top-4 right-4">
            <RankBadge rank={race.race_rank as RaceRank | null} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs font-medium text-[#ff9f1c]">
            <span>{race.keibajo_name}</span>
            <span className="text-[#f2efe6]/20">・</span>
            <span>
              {race.track_type}
              {race.distance_m}m
              {race.turn_direction && `(${race.turn_direction})`}
            </span>
            {race.race_class && (
              <>
                <span className="text-[#f2efe6]/20">・</span>
                <span>{race.race_class}</span>
              </>
            )}
            {race.entry_count && (
              <>
                <span className="text-[#f2efe6]/20">・</span>
                <span>{race.entry_count}頭</span>
              </>
            )}
            {(race.weather || race.track_condition) && (
              <>
                <span className="text-[#f2efe6]/20">・</span>
                <span>
                  {race.weather}
                  {race.weather && race.track_condition && "/"}
                  {race.track_condition}
                </span>
              </>
            )}
          </div>

          <h1 className="text-center text-2xl font-bold text-[#f2efe6]">
            {race.grade && <span className="mr-2 text-[#ff9f1c]">{race.grade}</span>}
            {race.race_number}R {race.race_name || race.race_class || "—"}
          </h1>

          <div className="text-center text-xs text-[#f2efe6]/45">
            {race.race_date}
            {race.post_time && ` ${race.post_time.slice(0, 5)}発走`}
          </div>

          {race.bias_note && (
            <p className="text-center text-sm text-[#f2efe6]/70">
              <span className="text-[#f2efe6]/45">トラックバイアス:</span> {race.bias_note}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[#f2efe6]/10 pt-3">
            {RANK_LEGEND.map(({ rank, label }) => (
              <span key={rank} className="flex items-center gap-1.5 text-xs text-[#f2efe6]/45">
                <RankBadge rank={rank} />
                {label}
              </span>
            ))}
          </div>

          {race.race_rank_reason && (
            <p className="text-sm leading-relaxed text-[#f2efe6]/70">{race.race_rank_reason}</p>
          )}

          <DiagnoseButton
            raceId={race.id}
            hasResult={race.race_rank !== null}
            raceRank={race.race_rank as RaceRank | null}
            raceClass={race.race_class}
            raceGrade={race.grade}
            premiumDiagnosedAt={race.premium_diagnosed_at}
          />

          <ReviewCheckbox raceId={race.id} initialReviewedAt={race.reviewed_at} />
        </header>

        {buySection}

        <EntriesList
          entries={sortedEntries}
          honmeiHorseNumber={race.honmei_horse_number}
          aiteHorseNumber={race.aite_horse_number}
          aiteHorseNumber2={race.aite_horse_number_2}
        />

        {analysisItems.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold text-[#f2efe6]/45">全体分析</h2>
            <dl className="flex flex-col gap-2">
              {analysisItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-[#f2efe6]/10 bg-[#12241f] p-3"
                >
                  <dt className="text-xs font-medium text-[#ff9f1c]">{item.label}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-[#f2efe6]/80">{item.text}</dd>
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
