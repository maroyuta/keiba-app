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
                    ? "border-[#ff9f1c]/60 bg-[#ff9f1c]/10 ring-1 ring-[#ff9f1c]/30"
                    : isAite
                      ? "border-teal-400/50 bg-teal-400/10 ring-1 ring-teal-400/25"
                      : "border-[#f2efe6]/10 bg-[#12241f]"
                } ${entry.is_kesshi ? "opacity-45" : ""}`}
              >
                <WakuBadge waku={entry.post_position} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs text-[#f2efe6]/45">
                      {entry.horse_number}番
                    </span>
                    <span className="truncate font-bold text-[#f2efe6]">
                      {entry.horses.horse_name}
                    </span>
                    {isHonmei && (
                      <span className="rounded bg-[#ff9f1c] px-1 text-xs font-bold text-[#0b1a17]">
                        本命
                      </span>
                    )}
                    {isAite && (
                      <span className="rounded bg-teal-400 px-1 text-xs font-bold text-[#0b1a17]">
                        相手
                      </span>
                    )}
                    {entry.is_kesshi && (
                      <span className="rounded bg-red-500/20 px-1 text-xs font-medium text-red-400">
                        消
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 font-mono text-xs text-[#ff9f1c]">
                    <span>
                      {entry.expected_popularity ? `${entry.expected_popularity}人気` : "—"}
                      {entry.odds_win !== null && ` (${formatOdds(entry.odds_win)}倍)`}
                    </span>
                    {isDangerFavorite && (
                      <span className="rounded bg-red-500/20 px-1 font-sans text-[10px] font-medium text-red-400">
                        危険な人気馬
                      </span>
                    )}
                  </div>
                  {entry.horse_rank_comment && (
                    <p className="mt-1 text-sm leading-snug text-[#f2efe6]/70">
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
