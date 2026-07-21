"use client";

import { useState } from "react";
import type { RaceEntryRow, HorseRow, RaceRank } from "@/lib/supabase/database.types";
import { RankBadge } from "../RankBadge";
import { WakuBadge } from "../WakuBadge";

// 単勝人気(想定)がこの番手を超える馬は、馬券方針上そもそも軸・相手にならない
// (route.tsのMAX_BET_POPULARITYと同じ基準)。見てもどうせ買わないのに全頭並ぶと
// 見づらいという指摘(2026-07-19)を受け、初期表示では折りたたむ。
const FOLD_BEYOND_POPULARITY = 9;

type EntryWithHorse = RaceEntryRow & { horses: HorseRow };

function formatOdds(odds: number | null): string {
  return odds === null ? "—" : odds.toFixed(1);
}

function EntryRow({
  entry,
  isHonmei,
  isAite,
  aiteLabel,
}: {
  entry: EntryWithHorse;
  isHonmei: boolean;
  isAite: boolean;
  aiteLabel: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-3 ${
        isHonmei
          ? "border-[#ff9f1c]/60 bg-[#ff9f1c]/10 ring-1 ring-[#ff9f1c]/30"
          : isAite
            ? "border-teal-400/50 bg-teal-400/10 ring-1 ring-teal-400/25"
            : "border-[#f2efe6]/10 bg-[#12241f]"
      }`}
    >
      <WakuBadge waku={entry.post_position} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-xs text-[#f2efe6]/45">{entry.horse_number}番</span>
          <span className="truncate font-bold text-[#f2efe6]">{entry.horses.horse_name}</span>
          {isHonmei && (
            <span className="rounded bg-[#ff9f1c] px-1 text-xs font-bold text-[#0b1a17]">本命</span>
          )}
          {isAite && (
            <span className="rounded bg-teal-400 px-1 text-xs font-bold text-[#0b1a17]">
              {aiteLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 font-mono text-xs text-[#ff9f1c]">
          <span>
            {entry.expected_popularity ? `${entry.expected_popularity}人気` : "—"}
            {entry.odds_win !== null && ` (${formatOdds(entry.odds_win)}倍)`}
          </span>
        </div>
        {entry.horse_rank_comment && (
          <p className="mt-1 text-sm leading-snug text-[#f2efe6]/70">{entry.horse_rank_comment}</p>
        )}
      </div>
      <RankBadge rank={entry.horse_rank as RaceRank | null} />
    </div>
  );
}

function aiteLabelFor(
  horseNumber: number,
  aiteHorseNumber: number | null,
  aiteHorseNumber2: number | null,
): string {
  if (horseNumber === aiteHorseNumber) return aiteHorseNumber2 ? "相手1" : "相手";
  if (horseNumber === aiteHorseNumber2) return "相手2";
  return "";
}

export function EntriesList({
  entries,
  honmeiHorseNumber,
  aiteHorseNumber,
  aiteHorseNumber2,
}: {
  entries: EntryWithHorse[];
  honmeiHorseNumber: number | null;
  aiteHorseNumber: number | null;
  aiteHorseNumber2: number | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const shown = entries.filter(
    (e) => (e.expected_popularity ?? 0) <= FOLD_BEYOND_POPULARITY || e.expected_popularity === null,
  );
  const folded = entries.filter(
    (e) => e.expected_popularity !== null && e.expected_popularity > FOLD_BEYOND_POPULARITY,
  );

  const isAite = (entry: EntryWithHorse) =>
    entry.horse_number === aiteHorseNumber || entry.horse_number === aiteHorseNumber2;

  return (
    <section className="flex flex-col gap-2">
      {shown.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          isHonmei={entry.horse_number === honmeiHorseNumber}
          isAite={isAite(entry)}
          aiteLabel={aiteLabelFor(entry.horse_number, aiteHorseNumber, aiteHorseNumber2)}
        />
      ))}

      {folded.length > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-xl border border-dashed border-[#f2efe6]/15 p-2 text-center text-xs text-[#f2efe6]/45 transition-colors hover:border-[#ff9f1c]/40 hover:text-[#ff9f1c]"
        >
          他{folded.length}頭を表示({FOLD_BEYOND_POPULARITY}番人気より下)
        </button>
      )}
      {expanded &&
        folded.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            isHonmei={entry.horse_number === honmeiHorseNumber}
            isAite={isAite(entry)}
            aiteLabel={aiteLabelFor(entry.horse_number, aiteHorseNumber, aiteHorseNumber2)}
          />
        ))}
    </section>
  );
}
