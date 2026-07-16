// SNSシェア画像のカードテンプレート(satori/ImageResponse用JSX)。
// satoriの制約: 複数子要素を持つdivは必ずdisplay:flex、gridは使えない。
import type { ReactElement, ReactNode } from "react";
import {
  SNS_BRAND,
  SNS_COLORS as C,
  WAKU_COLORS,
  type CardFormat,
} from "./theme";

export type CardRace = {
  race_date: string;
  keibajo_name: string | null;
  race_number: number;
  race_name: string | null;
  race_class: string | null;
  grade: string | null;
  track_type: string;
  distance_m: number;
  entry_count: number | null;
  race_rank: string | null;
  race_rank_reason: string | null;
  honmei_horse_number: number | null;
  aite_horse_number: number | null;
  bet_type: string | null;
};

export type CardEntry = {
  horse_number: number;
  post_position: number;
  horse_name: string;
  odds_win: number | null;
  expected_popularity: number | null;
  horse_rank: string | null;
  is_kesshi: boolean;
};

export type DigestRow = {
  keibajo_name: string | null;
  race_number: number;
  race_name: string | null;
  race_class: string | null;
  grade: string | null;
  race_rank: string | null;
  honmei_horse_number: number | null;
  aite_horse_number: number | null;
};

export type ResultRow = {
  keibajo_name: string | null;
  race_number: number;
  race_name: string | null;
  race_class: string | null;
  race_rank: string | null;
  is_hit: boolean | null;
  stake_yen: number | null;
  return_yen: number | null;
};

export type ResultsSummary = {
  title: string;
  bets: number;
  hits: number;
  stakeYen: number;
  returnYen: number;
  cumulativeNote: string | null;
};

const BET_TYPE_LABELS: Record<string, string> = {
  wide: "ワイド",
  umaren: "馬連",
  both: "ワイド・馬連",
};

const RANK_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

export function rankSortKey(rank: string | null): number {
  return rank !== null && rank in RANK_ORDER ? RANK_ORDER[rank] : 9;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// サーバーのTZに依存しないよう、日付文字列をUTCとして固定解釈する
// (JSTの+09:00で解釈+ローカルgetDay()だと、UTC環境で前日にズレる)
export function formatDateLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const youbi = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${youbi})`;
}

function rankChipColors(rank: string | null): {
  bg: string;
  fg: string;
  shadow?: string;
} {
  switch (rank) {
    case "S":
      return { bg: C.orange, fg: C.bg, shadow: "0 0 18px rgba(255,159,28,0.55)" };
    case "A":
      return { bg: C.tealSoft, fg: C.teal };
    case "B":
      return { bg: "rgba(242,239,230,0.12)", fg: C.cream };
    default:
      return { bg: "rgba(242,239,230,0.08)", fg: C.creamFaint };
  }
}

function RankChip({ rank, size }: { rank: string | null; size: number }) {
  const { bg, fg, shadow } = rankChipColors(rank);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        color: fg,
        fontSize: size * 0.52,
        fontWeight: 700,
        ...(shadow ? { boxShadow: shadow } : {}),
      }}
    >
      {rank ?? "—"}
    </div>
  );
}

function WakuChip({ waku, size }: { waku: number; size: number }) {
  const colors = WAKU_COLORS[waku] ?? { bg: "#3f3f46", fg: "#ffffff" };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 8,
        backgroundColor: colors.bg,
        color: colors.fg,
        fontSize: size * 0.55,
        fontWeight: 700,
        ...(waku === 1 ? { border: "1px solid #d4d4d8" } : {}),
      }}
    >
      {waku}
    </div>
  );
}

function Tag({
  label,
  bg,
  fg,
  fontSize,
}: {
  label: string;
  bg: string;
  fg: string;
  fontSize: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        backgroundColor: bg,
        color: fg,
        fontSize,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 6,
      }}
    >
      {label}
    </div>
  );
}

function BrandFooter({ scale }: { scale: number }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderTop: `1px solid ${C.line}`,
        paddingTop: 12 * scale,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 20 * scale, fontWeight: 700, color: C.orange }}>
          {SNS_BRAND.name}
        </div>
        <div style={{ display: "flex", fontSize: 14 * scale, color: C.creamDim }}>
          {SNS_BRAND.tagline}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 12 * scale, color: C.creamFaint }}>
        {SNS_BRAND.disclaimer}
      </div>
    </div>
  );
}

function CardRoot({
  children,
  width,
  height,
  padding,
}: {
  children: ReactNode;
  width: number;
  height: number;
  padding: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        height,
        padding,
        backgroundColor: C.bg,
        backgroundImage:
          "radial-gradient(circle at 20% 0%, rgba(255,159,28,0.10), transparent 45%), radial-gradient(circle at 90% 100%, rgba(45,212,191,0.07), transparent 40%)",
        color: C.cream,
        fontFamily: "Noto Sans JP",
      }}
    >
      {children}
    </div>
  );
}

function raceMetaLabel(race: CardRace): string {
  const parts = [
    race.keibajo_name ?? "",
    `${race.track_type}${race.distance_m}m`,
    race.race_class ?? "",
    race.entry_count ? `${race.entry_count}頭` : "",
  ].filter(Boolean);
  return parts.join(" ・ ");
}

function raceTitleLabel(race: CardRace): string {
  return `${race.race_number}R ${race.race_name || race.race_class || ""}`.trim();
}

// ---------------------------------------------------------------------------
// 1. レース診断カード
// ---------------------------------------------------------------------------

function EntryRow({
  entry,
  race,
  rowHeight,
  fontScale,
}: {
  entry: CardEntry;
  race: CardRace;
  rowHeight: number;
  fontScale: number;
}) {
  const isHonmei = entry.horse_number === race.honmei_horse_number;
  const isAite = entry.horse_number === race.aite_horse_number;
  const isDanger =
    entry.expected_popularity !== null &&
    entry.expected_popularity <= 5 &&
    (entry.horse_rank === "B" || entry.horse_rank === "C");
  const border = isHonmei
    ? `1px solid ${C.orangeLine}`
    : isAite
      ? "1px solid rgba(45,212,191,0.5)"
      : `1px solid ${C.line}`;
  const bg = isHonmei ? C.orangeSoft : isAite ? C.tealSoft : C.panel;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10 * fontScale,
        height: rowHeight,
        padding: `0 ${12 * fontScale}px`,
        borderRadius: 10,
        border,
        backgroundColor: bg,
        opacity: entry.is_kesshi ? 0.45 : 1,
      }}
    >
      <WakuChip waku={entry.post_position} size={26 * fontScale} />
      <div
        style={{
          display: "flex",
          width: 30 * fontScale,
          justifyContent: "flex-end",
          fontSize: 15 * fontScale,
          color: C.creamFaint,
        }}
      >
        {entry.horse_number}
      </div>
      <div
        style={{
          display: "flex",
          flexGrow: 1,
          fontSize: 17 * fontScale,
          fontWeight: 700,
        }}
      >
        {truncate(entry.horse_name, 9)}
      </div>
      {isHonmei && <Tag label="本命" bg={C.orange} fg={C.bg} fontSize={13 * fontScale} />}
      {isAite && <Tag label="相手" bg={C.teal} fg={C.bg} fontSize={13 * fontScale} />}
      {entry.is_kesshi && <Tag label="消" bg={C.redSoft} fg={C.red} fontSize={13 * fontScale} />}
      {isDanger && !entry.is_kesshi && (
        <Tag label="危険な人気馬" bg={C.redSoft} fg={C.red} fontSize={12 * fontScale} />
      )}
      <div
        style={{
          display: "flex",
          width: 104 * fontScale,
          justifyContent: "flex-end",
          fontSize: 14 * fontScale,
          color: C.orange,
        }}
      >
        {entry.expected_popularity ? `${entry.expected_popularity}人気` : "—"}
        {entry.odds_win ? ` ${entry.odds_win.toFixed(1)}倍` : ""}
      </div>
      <RankChip rank={entry.horse_rank} size={26 * fontScale} />
    </div>
  );
}

function BuyPanel({ race, scale }: { race: CardRace; scale: number }) {
  if (!race.honmei_horse_number) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12 * scale,
          borderRadius: 14,
          border: `1px solid ${C.line}`,
          backgroundColor: C.panel,
          padding: `${10 * scale}px ${16 * scale}px`,
        }}
      >
        <div style={{ display: "flex", fontSize: 15 * scale, color: C.creamDim }}>買い目</div>
        <div style={{ display: "flex", fontSize: 22 * scale, fontWeight: 700, color: C.creamFaint }}>
          見送り(馬券対象外)
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14 * scale,
        borderRadius: 14,
        border: `1px solid ${C.orangeLine}`,
        backgroundColor: C.orangeSoft,
        padding: `${10 * scale}px ${16 * scale}px`,
      }}
    >
      <div style={{ display: "flex", fontSize: 15 * scale, color: C.orange, fontWeight: 700 }}>
        買い目
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 * scale }}>
        <div style={{ display: "flex", fontSize: 30 * scale, fontWeight: 700 }}>
          ◎{race.honmei_horse_number}
        </div>
        {race.aite_horse_number && (
          <div style={{ display: "flex", fontSize: 30 * scale, fontWeight: 700, color: C.orange }}>
            → {race.aite_horse_number}
          </div>
        )}
        {race.bet_type && (
          <div style={{ display: "flex", fontSize: 16 * scale, color: C.creamDim }}>
            ({BET_TYPE_LABELS[race.bet_type] ?? race.bet_type})
          </div>
        )}
      </div>
    </div>
  );
}

export function RaceCard({
  race,
  entries,
  format,
}: {
  race: CardRace;
  entries: CardEntry[];
  format: CardFormat;
}): ReactElement {
  const sorted = [...entries].sort((a, b) => a.horse_number - b.horse_number);

  if (format === "story") {
    const rowHeight = Math.min(72, Math.floor(1150 / Math.max(sorted.length, 1)));
    return (
      <CardRoot width={1080} height={1920} padding={56}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: C.orange }}>
            {SNS_BRAND.name}
          </div>
          <div style={{ display: "flex", fontSize: 22, color: C.creamDim }}>
            {formatDateLabel(race.race_date)} レース診断
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 24, color: C.orange }}>
          {raceMetaLabel(race)}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            {race.grade && (
              <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: C.orange }}>
                {race.grade}
              </div>
            )}
            <div style={{ display: "flex", fontSize: 46, fontWeight: 700 }}>
              {truncate(raceTitleLabel(race), 14)}
            </div>
          </div>
          <RankChip rank={race.race_rank} size={84} />
        </div>
        <div style={{ display: "flex", marginTop: 24 }}>
          <BuyPanel race={race} scale={1.35} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 24, flexGrow: 1 }}>
          {sorted.map((entry) => (
            <EntryRow
              key={entry.horse_number}
              entry={entry}
              race={race}
              rowHeight={rowHeight}
              fontScale={1.25}
            />
          ))}
        </div>
        {race.race_rank_reason && (
          <div
            style={{
              display: "flex",
              marginTop: 20,
              marginBottom: 20,
              fontSize: 22,
              lineHeight: 1.5,
              color: C.creamDim,
            }}
          >
            {truncate(race.race_rank_reason, 110)}
          </div>
        )}
        <BrandFooter scale={1.3} />
      </CardRoot>
    );
  }

  // OG(1200x675): 出走馬は2カラム
  const half = Math.ceil(sorted.length / 2);
  const columns = [sorted.slice(0, half), sorted.slice(half)];
  const rowHeight = Math.min(44, Math.floor(380 / Math.max(half, 1)));
  return (
    <CardRoot width={1200} height={675} padding={36}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 19, color: C.orange }}>{raceMetaLabel(race)}</div>
        <div style={{ display: "flex", fontSize: 17, color: C.creamDim }}>
          {formatDateLabel(race.race_date)} レース診断
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            {race.grade && (
              <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: C.orange }}>
                {race.grade}
              </div>
            )}
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>
              {truncate(raceTitleLabel(race), 16)}
            </div>
          </div>
          <RankChip rank={race.race_rank} size={52} />
        </div>
        <BuyPanel race={race} scale={0.92} />
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 14, flexGrow: 1 }}>
        {columns.map((column, i) => (
          <div
            key={i}
            style={{ display: "flex", flexDirection: "column", gap: 5, width: "50%" }}
          >
            {column.map((entry) => (
              <EntryRow
                key={entry.horse_number}
                entry={entry}
                race={race}
                rowHeight={rowHeight}
                fontScale={0.86}
              />
            ))}
          </div>
        ))}
      </div>
      {race.race_rank_reason && (
        <div
          style={{
            display: "flex",
            marginTop: 10,
            marginBottom: 10,
            fontSize: 16,
            lineHeight: 1.45,
            color: C.creamDim,
          }}
        >
          {truncate(race.race_rank_reason, 95)}
        </div>
      )}
      <BrandFooter scale={0.9} />
    </CardRoot>
  );
}

// ---------------------------------------------------------------------------
// 2. 当日ダイジェストカード
// ---------------------------------------------------------------------------

function DigestRowItem({
  row,
  fontScale,
  rowHeight,
}: {
  row: DigestRow;
  fontScale: number;
  rowHeight: number;
}) {
  const hasBuy = row.honmei_horse_number !== null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10 * fontScale,
        height: rowHeight,
        padding: `0 ${12 * fontScale}px`,
        borderRadius: 10,
        border: hasBuy ? `1px solid ${C.orangeLine}` : `1px solid ${C.line}`,
        backgroundColor: hasBuy ? C.orangeSoft : C.panel,
      }}
    >
      <div
        style={{
          display: "flex",
          width: 104 * fontScale,
          fontSize: 15 * fontScale,
          color: C.creamDim,
        }}
      >
        {row.keibajo_name ?? "—"} {row.race_number}R
      </div>
      <div
        style={{
          display: "flex",
          flexGrow: 1,
          alignItems: "baseline",
          gap: 8 * fontScale,
        }}
      >
        {row.grade && (
          <div style={{ display: "flex", fontSize: 15 * fontScale, fontWeight: 700, color: C.orange }}>
            {row.grade}
          </div>
        )}
        <div style={{ display: "flex", fontSize: 17 * fontScale, fontWeight: 700 }}>
          {truncate(row.race_name || row.race_class || "—", 12)}
        </div>
      </div>
      {hasBuy && (
        <div style={{ display: "flex", fontSize: 16 * fontScale, fontWeight: 700, color: C.orange }}>
          ◎{row.honmei_horse_number}
          {row.aite_horse_number ? ` → ${row.aite_horse_number}` : ""}
        </div>
      )}
      {hasBuy ? (
        <Tag label="買い" bg={C.orange} fg={C.bg} fontSize={13 * fontScale} />
      ) : (
        <Tag label="見送り" bg="rgba(242,239,230,0.08)" fg={C.creamFaint} fontSize={13 * fontScale} />
      )}
      <RankChip rank={row.race_rank} size={26 * fontScale} />
    </div>
  );
}

export function DigestCard({
  dateLabel,
  title,
  rows,
  format,
}: {
  dateLabel: string;
  title: string;
  rows: DigestRow[];
  format: CardFormat;
}): ReactElement {
  const sorted = [...rows].sort(
    (a, b) =>
      rankSortKey(a.race_rank) - rankSortKey(b.race_rank) ||
      (a.keibajo_name ?? "").localeCompare(b.keibajo_name ?? "") ||
      a.race_number - b.race_number
  );
  const buys = sorted.filter((r) => r.honmei_horse_number !== null).length;
  const sCount = sorted.filter((r) => r.race_rank === "S").length;
  const aCount = sorted.filter((r) => r.race_rank === "A").length;
  const summary = `診断${sorted.length}R / 買い${buys}R / S評価${sCount} / A評価${aCount}`;

  if (format === "story") {
    const maxRows = 19;
    const shown = sorted.slice(0, maxRows);
    const rest = sorted.length - shown.length;
    const rowHeight = Math.min(76, Math.floor(1330 / Math.max(shown.length, 1)));
    return (
      <CardRoot width={1080} height={1920} padding={56}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: C.orange }}>
            {SNS_BRAND.name}
          </div>
          <div style={{ display: "flex", fontSize: 22, color: C.creamDim }}>{dateLabel}</div>
        </div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 52, fontWeight: 700 }}>{title}</div>
        <div style={{ display: "flex", marginTop: 10, fontSize: 24, color: C.orange }}>{summary}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 24, flexGrow: 1 }}>
          {shown.map((row, i) => (
            <DigestRowItem key={i} row={row} fontScale={1.25} rowHeight={rowHeight} />
          ))}
          {rest > 0 && (
            <div style={{ display: "flex", fontSize: 22, color: C.creamFaint, paddingLeft: 8 }}>
              ほか{rest}レース
            </div>
          )}
        </div>
        <BrandFooter scale={1.3} />
      </CardRoot>
    );
  }

  const maxRows = 16;
  const shown = sorted.slice(0, maxRows);
  const rest = sorted.length - shown.length;
  const half = Math.ceil(shown.length / 2);
  const columns = [shown.slice(0, half), shown.slice(half)];
  const rowHeight = Math.min(50, Math.floor(430 / Math.max(half, 1)));
  return (
    <CardRoot width={1200} height={675} padding={36}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>{title}</div>
          <div style={{ display: "flex", fontSize: 19, color: C.creamDim }}>{dateLabel}</div>
        </div>
        <div style={{ display: "flex", fontSize: 18, color: C.orange }}>{summary}</div>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 16, flexGrow: 1 }}>
        {columns.map((column, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, width: "50%" }}>
            {column.map((row, j) => (
              <DigestRowItem key={j} row={row} fontScale={0.9} rowHeight={rowHeight} />
            ))}
          </div>
        ))}
      </div>
      {rest > 0 && (
        <div style={{ display: "flex", fontSize: 15, color: C.creamFaint, marginTop: 6 }}>
          ほか{rest}レース
        </div>
      )}
      <BrandFooter scale={0.9} />
    </CardRoot>
  );
}

// ---------------------------------------------------------------------------
// 3. 結果・収支カード
// ---------------------------------------------------------------------------

function StatBlock({
  label,
  value,
  accent,
  scale,
}: {
  label: string;
  value: string;
  accent?: boolean;
  scale: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flexGrow: 1,
        borderRadius: 14,
        border: accent ? `1px solid ${C.orangeLine}` : `1px solid ${C.line}`,
        backgroundColor: accent ? C.orangeSoft : C.panel,
        padding: `${14 * scale}px ${10 * scale}px`,
        gap: 6 * scale,
      }}
    >
      <div style={{ display: "flex", fontSize: 15 * scale, color: C.creamDim }}>{label}</div>
      <div
        style={{
          display: "flex",
          fontSize: 30 * scale,
          fontWeight: 700,
          color: accent ? C.orange : C.cream,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function ResultsCard({
  summary,
  rows,
  format,
}: {
  summary: ResultsSummary;
  rows: ResultRow[];
  format: CardFormat;
}): ReactElement {
  const hitRate = summary.bets > 0 ? (summary.hits / summary.bets) * 100 : 0;
  const roi = summary.stakeYen > 0 ? (summary.returnYen / summary.stakeYen) * 100 : 0;
  const sortedRows = [...rows].sort(
    (a, b) =>
      Number(b.is_hit ?? false) - Number(a.is_hit ?? false) ||
      rankSortKey(a.race_rank) - rankSortKey(b.race_rank)
  );
  const scale = format === "story" ? 1.3 : 0.95;
  const maxRows = format === "story" ? 14 : 8;
  const shown = sortedRows.slice(0, maxRows);
  const rest = sortedRows.length - shown.length;
  const size = format === "story" ? { w: 1080, h: 1920, pad: 56 } : { w: 1200, h: 675, pad: 36 };

  const resultRow = (row: ResultRow, i: number) => (
    <div
      key={i}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12 * scale,
        padding: `${8 * scale}px ${12 * scale}px`,
        borderRadius: 10,
        border: row.is_hit ? `1px solid ${C.orangeLine}` : `1px solid ${C.line}`,
        backgroundColor: row.is_hit ? C.orangeSoft : C.panel,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 54 * scale,
          fontSize: 16 * scale,
          fontWeight: 700,
          color: row.is_hit ? C.orange : C.creamFaint,
        }}
      >
        {row.is_hit ? "的中" : "外れ"}
      </div>
      <div style={{ display: "flex", flexGrow: 1, fontSize: 17 * scale, fontWeight: 700 }}>
        {truncate(
          `${row.keibajo_name ?? ""}${row.race_number}R ${row.race_name || row.race_class || ""}`,
          16
        )}
      </div>
      <RankChip rank={row.race_rank} size={24 * scale} />
      <div
        style={{
          display: "flex",
          width: 190 * scale,
          justifyContent: "flex-end",
          fontSize: 16 * scale,
          color: row.is_hit ? C.orange : C.creamDim,
        }}
      >
        {(row.stake_yen ?? 0).toLocaleString()}円 → {(row.return_yen ?? 0).toLocaleString()}円
      </div>
    </div>
  );

  return (
    <CardRoot width={size.w} height={size.h} padding={size.pad}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <div style={{ display: "flex", fontSize: 34 * scale, fontWeight: 700 }}>
            {summary.title}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 20 * scale, fontWeight: 700, color: C.orange }}>
          {SNS_BRAND.name}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 * scale, marginTop: 16 * scale }}>
        <StatBlock
          label="購入 / 的中"
          value={`${summary.bets}件 / ${summary.hits}件`}
          scale={scale}
        />
        <StatBlock label="的中率" value={`${hitRate.toFixed(1)}%`} scale={scale} />
        <StatBlock
          label="投資 → 払戻"
          value={`${summary.stakeYen.toLocaleString()} → ${summary.returnYen.toLocaleString()}円`}
          scale={scale}
        />
        <StatBlock label="回収率" value={`${roi.toFixed(1)}%`} accent scale={scale} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 7 * scale,
          marginTop: 16 * scale,
          flexGrow: 1,
        }}
      >
        {shown.map(resultRow)}
        {rest > 0 && (
          <div style={{ display: "flex", fontSize: 16 * scale, color: C.creamFaint, paddingLeft: 8 }}>
            ほか{rest}件(外れ含む・全件はサイトで公開)
          </div>
        )}
      </div>
      {summary.cumulativeNote && (
        <div
          style={{
            display: "flex",
            marginTop: 10 * scale,
            marginBottom: 10 * scale,
            fontSize: 17 * scale,
            color: C.creamDim,
          }}
        >
          {summary.cumulativeNote}
        </div>
      )}
      <BrandFooter scale={scale} />
    </CardRoot>
  );
}
