import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvFileFromArgs } from "../netkeiba/loadEnvFile";
import { createNetkeibaSyncClient } from "../netkeiba/supabaseClient";
import { makeSlideshow } from "./makeVideo";

// SNS投稿コンテンツパック生成。指定日の診断/結果から、投稿用の画像・動画・
// 投稿文ドラフト(posts.md)を sns-out/<date>-<mode>/ に一式書き出す。
// 画像生成はNext.jsのルート(/api/sns/*)に任せるため、dev serverの起動が前提。
//
// 使い方:
//   npm run sns:pack -- --date 2026-07-25 --mode preview [--env-file .env.local]
//   npm run sns:pack -- --date 2026-07-25 --mode results [--env-file .env.local]
//
// preview = 前日夜・当日朝用(診断ダイジェスト+買いレースのカード+縦動画)
// results = 結果報告用(収支カード)

const RANK_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };
const BET_TYPE_LABELS: Record<string, string> = {
  wide: "ワイド",
  umaren: "馬連",
  both: "ワイド・馬連",
};

// TZ非依存(cards.tsxのformatDateLabelと同じ理由でUTC固定解釈)
function dateLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const youbi = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${youbi})`;
}

async function fetchImage(url: string, outPath: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    throw new Error(`${url} -> HTTP ${res.status}: ${await res.text()}`);
  }
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const args = loadEnvFileFromArgs(process.argv.slice(2));
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  const date = get("--date");
  const mode = get("--mode") ?? "preview";
  const baseUrl = get("--base-url") ?? "http://localhost:3000";
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !["preview", "results"].includes(mode)) {
    console.error(
      "使い方: npm run sns:pack -- --date YYYY-MM-DD [--mode preview|results] [--base-url http://localhost:3000] [--env-file .env.local]"
    );
    process.exit(1);
  }

  // dev server生存確認(画像生成ルートを叩くため)
  try {
    await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
  } catch {
    console.error(`${baseUrl} に接続できません。先に \`npm run dev\` を起動してください。`);
    process.exit(1);
  }

  const outDir = join(process.cwd(), "sns-out", `${date}-${mode}`);
  await mkdir(outDir, { recursive: true });
  const supabase = createNetkeibaSyncClient();
  const label = dateLabel(date);

  if (mode === "preview") {
    const { data: races, error } = await supabase
      .from("races")
      .select(
        "id, keibajo_name, race_number, race_name, race_class, grade, race_rank, race_rank_reason, honmei_horse_number, aite_horse_number, bet_type, post_time"
      )
      .eq("race_date", date)
      .not("race_rank", "is", null)
      .order("race_number");
    if (error) throw error;
    if (!races || races.length === 0) {
      console.error(`${date}に診断済みレースがありません。先に診断を実行してください。`);
      process.exit(1);
    }

    const buys = races
      .filter((r) => r.honmei_horse_number !== null)
      .sort(
        (a, b) =>
          (RANK_ORDER[a.race_rank ?? ""] ?? 9) - (RANK_ORDER[b.race_rank ?? ""] ?? 9) ||
          a.race_number - b.race_number
      );
    const venues = [...new Set(races.map((r) => r.keibajo_name).filter(Boolean))];
    const sCount = races.filter((r) => r.race_rank === "S").length;
    const aCount = races.filter((r) => r.race_rank === "A").length;

    // 画像: ダイジェスト(og+story) + 買いレースのカード(og+story、最大6R)
    console.log("画像を生成中...");
    await fetchImage(`${baseUrl}/api/sns/digest?date=${date}`, join(outDir, "digest-og.png"));
    await fetchImage(
      `${baseUrl}/api/sns/digest?date=${date}&format=story`,
      join(outDir, "digest-story.png")
    );
    const cardTargets = buys.slice(0, 6);
    const storyImages = [join(outDir, "digest-story.png")];
    for (const race of cardTargets) {
      const stem = `race-${race.keibajo_name ?? "x"}${race.race_number}R`;
      await fetchImage(`${baseUrl}/api/sns/race-card/${race.id}`, join(outDir, `${stem}-og.png`));
      await fetchImage(
        `${baseUrl}/api/sns/race-card/${race.id}?format=story`,
        join(outDir, `${stem}-story.png`)
      );
      storyImages.push(join(outDir, `${stem}-story.png`));
      console.log(`  ${stem}`);
    }

    console.log("縦動画を生成中...");
    await makeSlideshow(storyImages, join(outDir, "video-preview.mp4"));

    // 投稿文ドラフト。X無料アカウントは日本語ほぼ140字が上限のため、
    // 狙いは上位3Rまでに圧縮し、残りは添付画像(ダイジェスト)に載せる。
    const topLines = cardTargets
      .slice(0, 3)
      .map(
        (r) =>
          `${r.keibajo_name}${r.race_number}R ◎${r.honmei_horse_number}` +
          (r.aite_horse_number ? `→${r.aite_horse_number}` : "")
      )
      .join(" / ");
    const restNote = buys.length > 3 ? ` ほか${buys.length - 3}R` : "";

    const postsMd = `# ${label} 投稿パック(preview)

生成: ${new Date().toISOString()} / 対象: 診断${races.length}R・買い${buys.length}R(S${sCount}/A${aCount})
※X無料アカウントは全角約140字が上限。下書きが超える場合は狙い行から削る

## 1. 前日夜ポスト(前日の20:00〜21:00、添付: digest-og.png)

【${label}の診断】
AIが${venues.join("・")}の${races.length}Rを事前診断、買いは${buys.length}R。
狙い: ${topLines}${restNote}
全レースは画像で。結果は外れも全部報告します。
#競馬予想

## 2. 当日朝ポスト(7:30〜8:30、添付: digest-og.png または各race-*-og.png)

【きょうの狙い】${label}
${topLines}${restNote}
発走前に全公開。的中も外れも夕方に報告します。
#競馬予想

## 3. 個別レースポスト(狙いレースのみ任意、添付: 該当のrace-*-og.png)

${cardTargets
  .map((r) => {
    const reason = r.race_rank_reason ?? "";
    const shortReason = reason.length > 60 ? `${reason.slice(0, 59)}…` : reason;
    return `--- ${r.keibajo_name}${r.race_number}R ---\n${r.keibajo_name}${r.race_number}R ${r.race_name || r.race_class || ""}(${r.race_rank}評価)\n◎${r.honmei_horse_number}${r.aite_horse_number ? `→${r.aite_horse_number}` : ""}${r.bet_type ? ` ${BET_TYPE_LABELS[r.bet_type] ?? r.bet_type}` : ""}\n${shortReason}\n#競馬予想 #${r.keibajo_name}競馬`;
  })
  .join("\n\n")}

## 4. TikTok(添付: video-preview.mp4 または *-story.png を写真モードで)

キャプション案:
AIが週末の競馬を全レース診断🐎 ${label}の狙いは${buys.length}レース
結果は外れも全部プロフィールのXで公開してます
#競馬 #競馬予想 #AI #データ分析 #fyp

※音源はTikTok内でトレンド音源を付ける(権利的にも安全)

## 運用メモ
- 投稿は必ず発走前に。結果報告はこのポストを引用RTで対にする
- 「絶対」「鉄板」等の断定表現は使わない(表現は「妙味」「期待値」)
`;
    await writeFile(join(outDir, "posts.md"), postsMd);
    console.log(`✅ ${outDir} に一式出力しました(画像${storyImages.length + cardTargets.length + 1}枚+動画+posts.md)`);
    return;
  }

  // results mode
  const { data: results, error } = await supabase
    .from("race_recommendation_results")
    .select(
      "is_hit, stake_yen, return_yen, race_rank, bet_type, races!inner(race_date, keibajo_name, race_number, race_name, race_class)"
    )
    .not("computed_at", "is", null)
    .gte("races.race_date", date)
    .lte("races.race_date", date);
  if (error) throw error;
  if (!results || results.length === 0) {
    console.error(
      `${date}の確定済み結果がありません。compute_recommendation_results実行後に再実行してください。`
    );
    process.exit(1);
  }

  console.log("画像を生成中...");
  await fetchImage(`${baseUrl}/api/sns/results?from=${date}`, join(outDir, "results-og.png"));
  await fetchImage(
    `${baseUrl}/api/sns/results?from=${date}&format=story`,
    join(outDir, "results-story.png")
  );
  await makeSlideshow([join(outDir, "results-story.png")], join(outDir, "video-results.mp4"), {
    duration: 6,
  });

  const hits = results.filter((r) => r.is_hit);
  const stake = results.reduce((sum, r) => sum + (r.stake_yen ?? 0), 0);
  const ret = results.reduce((sum, r) => sum + (r.return_yen ?? 0), 0);
  const roi = stake > 0 ? ((ret / stake) * 100).toFixed(1) : "—";
  const hitLines =
    hits.length > 0
      ? hits
          .slice(0, 3)
          .map(
            (r) =>
              `的中: ${r.races.keibajo_name}${r.races.race_number}R (${(r.stake_yen ?? 0).toLocaleString()}円→${(r.return_yen ?? 0).toLocaleString()}円)`
          )
          .join("\n") + (hits.length > 3 ? `\nほか的中${hits.length - 3}件` : "")
      : "きょうは的中なし。";

  const postsMd = `# ${label} 投稿パック(results)

## 結果ポスト(レース終了後の16:30〜17:30、添付: results-og.png、朝の予想ポストを引用RT)

【結果】${label}
購入${results.length}件・的中${hits.length}件(${((hits.length / results.length) * 100).toFixed(1)}%)
投資${stake.toLocaleString()}円 → 払戻${ret.toLocaleString()}円(回収率${roi}%)
${hitLines}
外れも全部残します。
#競馬予想

## TikTok(添付: video-results.mp4)

キャプション案:
AIの競馬予想、${label}の結果は購入${results.length}件・的中${hits.length}件(回収率${roi}%)🐎
外れも全部公開する方針でやってます
#競馬 #競馬予想 #AI

## 運用メモ
- 必ず当日の予想ポストを引用RTする(後出しでない証明)
- 的中ゼロの日も同じテンションで出す。それが差別化
`;
  await writeFile(join(outDir, "posts.md"), postsMd);
  console.log(`✅ ${outDir} に一式出力しました`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
