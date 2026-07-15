import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen w-full bg-[#0b1a17] bg-[radial-gradient(circle_at_20%_0%,rgba(255,159,28,0.10),transparent_45%)] px-4 py-6 text-[#f2efe6] sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <p className="text-[11px] font-bold tracking-[0.2em] text-[#ff9f1c]">
          LIVE ODDS · AI DIAGNOSIS
        </p>
        <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-balance">
          回収率で勝つ、
          <br />
          静かな一撃。
        </h1>
        <p className="max-w-[30ch] text-sm leading-relaxed text-[#f2efe6]/60">
          オッズ妙味×回収率重視のAI診断。本命と、掲示板に届く一頭を。
        </p>
        <div className="flex gap-3">
          <Link
            href="/races"
            className="rounded-lg bg-[#ff9f1c] px-5 py-2.5 text-sm font-bold text-[#0b1a17] transition-opacity hover:opacity-90"
          >
            レース一覧
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-[#f2efe6]/18 bg-white/[0.04] px-5 py-2.5 text-sm font-bold text-[#f2efe6] transition-colors hover:bg-white/[0.08]"
          >
            回収率
          </Link>
        </div>
      </div>
    </div>
  );
}
