import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-emerald-50 via-white to-white px-4 py-6 text-zinc-900 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-lg text-white shadow-sm shadow-emerald-500/30">
            🐎
          </span>
          <h1 className="text-xl font-bold tracking-tight">競馬予想</h1>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-white/80 p-5 shadow-sm shadow-emerald-900/5">
          <p className="text-sm text-zinc-500">オッズ妙味×回収率重視のAI診断</p>
          <div className="mt-4 flex gap-3">
            <Link
              href="/races"
              className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-600/30 transition-colors hover:bg-emerald-700"
            >
              レース一覧を見る
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-emerald-200 bg-white px-5 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              回収率を見る
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
