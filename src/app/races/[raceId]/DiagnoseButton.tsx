"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DiagnoseButton({
  raceId,
  hasResult,
  raceRank,
  raceClass,
  raceGrade,
  premiumDiagnosedAt,
}: {
  raceId: string;
  hasResult: boolean;
  raceRank: "S" | "A" | "B" | "C" | null;
  raceClass: string | null;
  raceGrade: string | null;
  premiumDiagnosedAt: string | null;
}) {
  const router = useRouter();
  // 重賞はrace_rankによらず本気診断の対象にする(route.tsの重賞バイパスと揃える。
  // 2026-07-13、B/C評価の重賞がボタンから漏れるバグを修正)。
  const isPremiumEligible =
    (raceGrade !== null || raceRank === "S" || raceRank === "A") &&
    !raceClass?.includes("未勝利") &&
    !raceClass?.includes("新馬");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [premiumStatus, setPremiumStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function runDiagnosis(tier?: "premium") {
    const setLoading = tier === "premium" ? setPremiumStatus : setStatus;
    setLoading("loading");
    setErrorMessage(null);
    try {
      const url = tier === "premium"
        ? `/api/races/${raceId}/diagnose?tier=premium`
        : `/api/races/${raceId}/diagnose`;
      const response = await fetch(url, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      setLoading("idle");
      router.refresh();
    } catch (err) {
      setLoading("error");
      setErrorMessage(err instanceof Error ? err.message : "診断に失敗しました");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={() => runDiagnosis()}
          disabled={status === "loading"}
          className="self-start rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "診断中… (最大1分ほどかかります)" : hasResult ? "再診断する" : "診断する"}
        </button>
        {isPremiumEligible && (
          <button
            type="button"
            onClick={() => runDiagnosis("premium")}
            disabled={premiumStatus === "loading"}
            className="self-start rounded-full border border-amber-400 px-4 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {premiumStatus === "loading" ? "本気診断中… (3分ほどかかります)" : "本気診断する"}
          </button>
        )}
      </div>
      {isPremiumEligible && premiumDiagnosedAt && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-[#f2efe6]/60">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
          本気診断済(
          {new Date(premiumDiagnosedAt).toLocaleString("ja-JP", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Tokyo",
          })}
          )
        </p>
      )}
      {errorMessage && <p className="text-center text-sm text-red-400">{errorMessage}</p>}
    </div>
  );
}
