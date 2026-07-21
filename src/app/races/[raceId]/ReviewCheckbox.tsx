"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReviewCheckbox({
  raceId,
  initialReviewedAt,
}: {
  raceId: string;
  initialReviewedAt: string | null;
}) {
  const router = useRouter();
  const [reviewedAt, setReviewedAt] = useState(initialReviewedAt);
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    const checked = reviewedAt !== null;
    try {
      const response = await fetch(`/api/races/${raceId}/review`, {
        method: checked ? "DELETE" : "POST",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setReviewedAt(checked ? null : new Date().toISOString());
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <label className="flex items-center justify-center gap-2 border-t border-[#f2efe6]/10 pt-3 text-sm text-[#f2efe6]/70">
      <input
        type="checkbox"
        checked={reviewedAt !== null}
        disabled={pending}
        onChange={toggle}
        className="h-4 w-4 accent-[#ff9f1c]"
      />
      確認済み
      {reviewedAt && (
        <span className="text-xs text-[#f2efe6]/45">
          (
          {new Date(reviewedAt).toLocaleString("ja-JP", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Tokyo",
          })}
          )
        </span>
      )}
    </label>
  );
}
