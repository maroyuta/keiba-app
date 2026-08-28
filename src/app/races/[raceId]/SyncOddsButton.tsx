"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// netkeibaのオッズAPI経由で単勝・馬連・ワイドを取得するボタン。無料(Anthropic API呼び出し無し)、
// JV-Link(Windows)が動いていない週末でもこれだけでオッズが入る。
export function SyncOddsButton({ raceId }: { raceId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setStatus("loading");
    setMessage(null);
    try {
      const response = await fetch(`/api/races/${raceId}/sync-odds`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      setStatus("idle");
      setMessage(`オッズ取得完了(${body.entriesUpdated}頭分)`);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "オッズ取得に失敗しました");
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={run}
        disabled={status === "loading"}
        className="self-center rounded-full border border-sky-400 px-4 py-2 text-sm font-medium text-sky-400 transition-colors hover:bg-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "loading" ? "オッズ取得中…" : "オッズ取得"}
      </button>
      {message && (
        <p className={`text-xs ${status === "error" ? "text-red-400" : "text-[#f2efe6]/60"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
