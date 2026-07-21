import { loadEnvFileFromArgs } from "./netkeiba/loadEnvFile";
import { createNetkeibaSyncClient } from "./netkeiba/supabaseClient";

// 前日夜(金/土 22:00想定)に、翌日開催の全レースへ標準診断(screening→standard、Haiku/Sonnet)を
// 自動でまとめてかけるバッチ。premium(Opus、本気診断)は課金インパクトが大きいため
// 従来通り手動ボタンのみとし、このバッチでは呼ばない。
//
// 実行順序の前提: このスクリプトの前に`npm run sync:netkeiba:shutuba -- --date <対象日>`を
// 実行し、枠順・当夜時点のオッズを反映させておくこと(run_diagnose_upcoming.shがまとめて呼ぶ)。
//
// 使い方:
//   npx tsx scripts/diagnoseUpcoming.ts --date YYYY-MM-DD --base-url https://keiba-app-lovat.vercel.app [--env-file .env.local] [--dry-run]

const DATA_SUFFICIENCY_MIN_RATIO = 0.5; // 過去走が1件もない馬がこの割合を超えたら中断(既存の運用ルールと同じ基準)
const DELAY_BETWEEN_RACES_MS = 3000; // standard診断は数十秒かかるため実質的な間隔は自然に空くが、念のため

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Supabase-jsの.in()は200件超のIDを渡すと結果が静かにtruncateされることがある実例に
// 遭遇している(AGENTS.md参照、232件渡して37件しか処理されなかったケース)。
// 大量IDのクエリは必ずこのヘルパーでチャンク分割すること。
const SUPABASE_IN_CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  const args = loadEnvFileFromArgs(process.argv.slice(2));
  const dateIdx = args.indexOf("--date");
  const baseUrlIdx = args.indexOf("--base-url");
  const dryRun = args.includes("--dry-run");

  const date = dateIdx !== -1 ? args[dateIdx + 1] : undefined;
  const baseUrl = baseUrlIdx !== -1 ? args[baseUrlIdx + 1] : "https://keiba-app-lovat.vercel.app";
  if (!date) {
    console.error(
      "使い方: npx tsx scripts/diagnoseUpcoming.ts --date YYYY-MM-DD [--base-url <url>] [--env-file <path>] [--dry-run]",
    );
    process.exit(1);
  }

  const supabase = createNetkeibaSyncClient();

  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id, race_number, keibajo_name, race_name, race_class, track_type, entry_count")
    .eq("race_date", date)
    .neq("track_type", "障害")
    .order("keibajo_code", { ascending: true })
    .order("race_number", { ascending: true });
  if (racesError) {
    throw new Error(`races取得に失敗: ${racesError.message}`);
  }

  const targets = (races ?? []).filter(
    (r) => !r.race_class?.includes("新馬") && !r.race_class?.includes("未勝利"),
  );
  console.log(`[info] ${date}の診断対象候補: ${targets.length}件(新馬/未勝利/障害は除外済み)`);
  if (targets.length === 0) {
    console.log("[info] 対象レースが無いため終了します");
    return;
  }

  // 有料バッチ前のデータ充足率チェック(運用ルール、AGENTS.md参照)。
  // 過去走(past_performances)が1件も無い馬の割合が高いレースが多いと、オッズ頼みの
  // 当てずっぽう診断になり無駄撃ちになるため、事前にコード側で機械チェックする。
  const raceIds = targets.map((r) => r.id);
  const { data: entries, error: entriesError } = await supabase
    .from("race_entries")
    .select("horse_id, race_id")
    .in("race_id", raceIds);
  if (entriesError) {
    throw new Error(`race_entries取得に失敗: ${entriesError.message}`);
  }
  const horseIds = [...new Set((entries ?? []).map((e) => e.horse_id))];
  let horsesWithHistory = 0;
  if (horseIds.length > 0) {
    const horsesWithHistorySet = new Set<string>();
    // PostgRESTはデフォルトで1レスポンスあたり最大1000行しか返さないため、
    // 馬1頭あたり複数走ある過去走テーブルは.in()のID数を絞っても行数側で
    // 静かに切り詰められる(2026-07-18、215頭で実際に発生・原因特定)。
    // .range()でページングして全件取得する。
    const PAGE_SIZE = 1000;
    for (const idChunk of chunk(horseIds, SUPABASE_IN_CHUNK_SIZE)) {
      let from = 0;
      for (;;) {
        const { data: pastPerf, error: pastError } = await supabase
          .from("past_performances")
          .select("horse_id")
          .in("horse_id", idChunk)
          .lt("race_date", date)
          .range(from, from + PAGE_SIZE - 1);
        if (pastError) {
          throw new Error(`past_performances取得に失敗: ${pastError.message}`);
        }
        for (const p of pastPerf ?? []) horsesWithHistorySet.add(p.horse_id);
        if (!pastPerf || pastPerf.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }
    horsesWithHistory = horsesWithHistorySet.size;
  }
  const sufficiencyRatio = horseIds.length > 0 ? horsesWithHistory / horseIds.length : 0;
  console.log(
    `[info] データ充足率: 過去走ありの馬 ${horsesWithHistory}/${horseIds.length}頭 ` +
      `(${(sufficiencyRatio * 100).toFixed(1)}%)`,
  );
  if (horseIds.length > 0 && sufficiencyRatio < DATA_SUFFICIENCY_MIN_RATIO) {
    console.error(
      `[abort] データ充足率が${(DATA_SUFFICIENCY_MIN_RATIO * 100).toFixed(0)}%未満のため中断します。` +
        `先に npm run sync:netkeiba:horse でバックフィルしてから再実行してください。`,
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log("[dry-run] 以下を診断予定(実際のAPI呼び出しはしません):");
    for (const r of targets) {
      console.log(`  ${r.keibajo_name}${r.race_number}R ${r.race_name ?? r.race_class} (${r.entry_count}頭)`);
    }
    return;
  }

  const runStart = new Date().toISOString();
  let ok = 0;
  let failed = 0;
  for (const race of targets) {
    const url = `${baseUrl}/api/races/${race.id}/diagnose`;
    try {
      const res = await fetch(url, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        failed += 1;
        console.warn(`[warn] ${race.keibajo_name}${race.race_number}R 失敗 (${res.status}):`, body);
      } else {
        ok += 1;
        console.log(
          `[ok] ${race.keibajo_name}${race.race_number}R tier=${body?.tier} race_rank=${body?.race_rank ?? body?.result?.race_rank ?? "-"}`,
        );
      }
    } catch (err) {
      failed += 1;
      console.warn(`[warn] ${race.keibajo_name}${race.race_number}R 通信エラー:`, err);
    }
    await sleep(DELAY_BETWEEN_RACES_MS);
  }

  const { data: usageRows } = await supabase
    .from("api_usage_log")
    .select("estimated_cost_usd")
    .in("race_id", raceIds)
    .gte("created_at", runStart);
  const totalCostUsd = (usageRows ?? []).reduce((sum, r) => sum + (r.estimated_cost_usd ?? 0), 0);

  console.log(
    `\n=== 完了 === 成功=${ok}件 失敗=${failed}件 実測コスト=$${totalCostUsd.toFixed(4)}` +
      `(≈¥${Math.round(totalCostUsd * 150)})`,
  );

  // 「S/Aが多すぎて5〜6レースに絞れない」問題への対応(2026-07-18)。診断完了後、race_priority_score
  // (0-100、race_rank内での妙味・確信度の相対値)で並び替えたおすすめ一覧を表示する。
  // race_rankのカテゴリだけでは同点多数になりやすいため、この点数を優先順位の最終判断材料にする。
  // **Sは1日最大4件までに自動的に絞られる(2026-07-19、src/lib/rank/capDailySRank.ts参照)。**
  // このバッチが呼ぶ/api/races/[raceId]/diagnose側でレース1件ごとに機械的にチェック・格下げ済みなので、
  // 下記の一覧に出るS評価は既にその上限を通過したものだけになっている。
  const { data: ranked } = await supabase
    .from("races")
    .select(
      "keibajo_name, race_number, race_name, race_rank, race_priority_score, honmei_horse_number, aite_horse_number, bet_type, grade",
    )
    .in("id", raceIds)
    .in("race_rank", ["S", "A"])
    .not("honmei_horse_number", "is", null)
    .order("race_priority_score", { ascending: false, nullsFirst: false });

  if (ranked && ranked.length > 0) {
    const RECOMMENDED_COUNT = 6;
    console.log(
      `\n=== 買い目候補(race_priority_score順、上位${RECOMMENDED_COUNT}レースが目安) ===`,
    );
    ranked.forEach((r, i) => {
      const mark = i < RECOMMENDED_COUNT ? "★" : " ";
      console.log(
        `${mark} ${String(i + 1).padStart(2)}. [${r.race_rank}/${r.race_priority_score ?? "?"}点] ` +
          `${r.keibajo_name}${r.race_number}R ${r.race_name ?? ""} ` +
          `本命${r.honmei_horse_number}-相手${r.aite_horse_number}(${r.bet_type})` +
          `${r.grade ? " [重賞]" : ""}`,
      );
    });
    if (ranked.length > RECOMMENDED_COUNT) {
      console.log(
        `\n[info] S/A評価が${ranked.length}件と基本の5〜6レースを超えています。★の上位${RECOMMENDED_COUNT}件を` +
          `優先候補としていますが、最終判断はrace_rank_reason・analysis_valueの中身も確認して決めること` +
          `(race_priority_scoreはあくまで診断の自己申告値で、絶対の正解ではない)。`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
