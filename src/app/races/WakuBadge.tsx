// JRAの枠番配色(公式の帽子・枠色に準拠): 1白 2黒 3赤 4青 5黄 6緑 7橙 8桃
const WAKU_STYLES: Record<number, string> = {
  1: "bg-white text-zinc-900 border border-zinc-300",
  2: "bg-zinc-900 text-white border border-zinc-700",
  3: "bg-red-600 text-white",
  4: "bg-blue-600 text-white",
  5: "bg-yellow-400 text-zinc-900",
  6: "bg-green-600 text-white",
  7: "bg-orange-500 text-white",
  8: "bg-pink-400 text-zinc-900",
};

export function WakuBadge({ waku }: { waku: number | null }) {
  if (!waku) {
    return (
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-700 text-sm font-bold text-zinc-300">
        —
      </span>
    );
  }
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold ${WAKU_STYLES[waku] ?? "bg-zinc-700 text-white"}`}
    >
      {waku}
    </span>
  );
}
