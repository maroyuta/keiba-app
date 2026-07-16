// SNSシェア画像の共通テーマ。サイト本体(races/[raceId]/page.tsx等)の
// ダーク+電光掲示板風(オレンジ/シアン)と同じパレットを使う。
export const SNS_COLORS = {
  bg: "#0b1a17",
  panel: "#12241f",
  line: "rgba(242,239,230,0.10)",
  cream: "#f2efe6",
  creamDim: "rgba(242,239,230,0.55)",
  creamFaint: "rgba(242,239,230,0.35)",
  orange: "#ff9f1c",
  orangeSoft: "rgba(255,159,28,0.12)",
  orangeLine: "rgba(255,159,28,0.45)",
  teal: "#2dd4bf",
  tealSoft: "rgba(45,212,191,0.14)",
  red: "#f87171",
  redSoft: "rgba(248,113,113,0.16)",
} as const;

// アカウント名を変える場合はここだけ直せば全カードに反映される
export const SNS_BRAND = {
  name: "AI競馬アナリスト",
  tagline: "予想は発走前に公開・結果は外れも全公開",
  disclaimer: "馬券は自己責任で / 20歳未満の勝馬投票券の購入は禁止されています",
} as const;

// JRA枠番配色(WakuBadge.tsxと同じ準拠)
export const WAKU_COLORS: Record<number, { bg: string; fg: string }> = {
  1: { bg: "#ffffff", fg: "#18181b" },
  2: { bg: "#18181b", fg: "#ffffff" },
  3: { bg: "#dc2626", fg: "#ffffff" },
  4: { bg: "#2563eb", fg: "#ffffff" },
  5: { bg: "#facc15", fg: "#18181b" },
  6: { bg: "#16a34a", fg: "#ffffff" },
  7: { bg: "#f97316", fg: "#ffffff" },
  8: { bg: "#f472b6", fg: "#18181b" },
};

export const OG_SIZE = { width: 1200, height: 675 } as const;
export const STORY_SIZE = { width: 1080, height: 1920 } as const;

export type CardFormat = "og" | "story";

export function cardSize(format: CardFormat) {
  return format === "story" ? STORY_SIZE : OG_SIZE;
}
