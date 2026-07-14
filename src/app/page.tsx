import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-white px-4 py-16 text-center text-zinc-900">
      <h1 className="text-xl font-bold">競馬予想</h1>
      <div className="flex gap-3">
        <Link
          href="/races"
          className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
        >
          レース一覧を見る
        </Link>
        <Link
          href="/dashboard"
          className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50"
        >
          回収率を見る
        </Link>
      </div>
    </div>
  );
}
