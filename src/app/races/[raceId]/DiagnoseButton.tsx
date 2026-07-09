"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DiagnoseButton({
  raceId,
  hasResult,
}: {
  raceId: string;
  hasResult: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleClick() {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/races/${raceId}/diagnose`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      setStatus("idle");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "診断に失敗しました");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "loading"}
        className="self-start rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {status === "loading" ? "診断中… (最大1分ほどかかります)" : hasResult ? "再診断する" : "診断する"}
      </button>
      {errorMessage && <p className="text-sm text-red-500">{errorMessage}</p>}
    </div>
  );
}
