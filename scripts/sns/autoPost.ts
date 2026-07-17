import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnvFileFromArgs } from "../netkeiba/loadEnvFile";
import { createNetkeibaSyncClient } from "../netkeiba/supabaseClient";
import { renderDigest, renderResults, toBuffer } from "@/lib/sns/render";
import { validatePreview, validateResults } from "@/lib/sns/validate";
import {
  composeEveningPreview,
  composeMorningPreview,
  composeResults,
  describeLength,
  loadPreviewData,
  loadResultsData,
} from "@/lib/sns/compose";
import { isConfigured, postToX } from "@/lib/sns/xClient";
import { makeSlideshow } from "./makeVideo";

// SNS自動投稿の司令塔。launchdから各時刻に呼ばれる。
//
//   npx tsx scripts/sns/autoPost.ts --mode evening|morning|results [--date YYYY-MM-DD]
//                                   [--env-file .env.local] [--dry-run]
//
// 流れ: バリデーション → 画像生成 → 本文組み立て → X投稿 → 記録・通知
// バリデーションでerrorが出たら投稿せず通知だけ出す(壊れたデータの公開を防ぐ)。
// X_*の環境変数が未設定なら自動的にdry-run(投稿せずログのみ)。

type Mode = "evening" | "morning" | "results";

// 投稿したツイートIDの記録。結果報告を朝の予想の引用RTにするために使う。
type PostedState = Record<string, { morning?: string; evening?: string; results?: string }>;

const STATE_PATH = join(process.cwd(), "sns-out", "posted.json");

async function loadState(): Promise<PostedState> {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

async function saveState(state: PostedState): Promise<void> {
  await mkdir(join(process.cwd(), "sns-out"), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

// macOSの通知センターに出す。launchdからの無人実行でも気づけるようにする。
async function notify(title: string, message: string): Promise<void> {
  const escape = (s: string) => s.replace(/["\\]/g, "\\$&").slice(0, 200);
  try {
    await promisify(execFile)("/usr/bin/osascript", [
      "-e",
      `display notification "${escape(message)}" with title "${escape(title)}"`,
    ]);
  } catch {
    // 通知が出せなくても本処理は止めない
  }
}

function jstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function jstTomorrow(): string {
  return new Date(Date.now() + 33 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const args = loadEnvFileFromArgs(process.argv.slice(2));
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  const mode = get("--mode") as Mode | null;
  if (!mode || !["evening", "morning", "results"].includes(mode)) {
    console.error(
      "使い方: npx tsx scripts/sns/autoPost.ts --mode evening|morning|results [--date YYYY-MM-DD] [--env-file <path>] [--dry-run]"
    );
    process.exit(1);
  }
  if (args.includes("--dry-run")) {
    process.env.X_DRY_RUN = "1";
  }

  // evening(前日夜)は翌日分、morning/resultsは当日分が既定
  const date = get("--date") ?? (mode === "evening" ? jstTomorrow() : jstToday());
  const supabase = createNetkeibaSyncClient();
  const outDir = join(process.cwd(), "sns-out", `${date}-auto`);
  await mkdir(outDir, { recursive: true });

  console.log(`=== ${new Date().toISOString()} autoPost mode=${mode} date=${date} ===`);
  console.log(`X認証: ${isConfigured() ? "設定済み" : "未設定(dry-run)"}`);

  // --- 1. バリデーション ---
  const validation =
    mode === "results"
      ? await validateResults(supabase, date)
      : await validatePreview(supabase, date);
  for (const w of validation.warnings) console.log(`[warn] ${w}`);
  if (!validation.ok) {
    for (const e of validation.errors) console.error(`[error] ${e}`);
    await notify(
      "SNS自動投稿を中止しました",
      `${date} ${mode}: ${validation.errors[0]}`
    );
    process.exit(1);
  }
  console.log("[ok] バリデーション通過");

  // --- 2. 画像生成 + 3. 本文 ---
  let text: string;
  let imagePath: string;
  let quoteTweetId: string | undefined;
  const state = await loadState();

  if (mode === "results") {
    const res = await renderResults(supabase, date, date, "og");
    if (!res) {
      await notify("SNS自動投稿を中止しました", `${date} results: 画像を生成できません`);
      process.exit(1);
    }
    imagePath = join(outDir, "results-og.png");
    await writeFile(imagePath, await toBuffer(res));

    const story = await renderResults(supabase, date, date, "story");
    if (story) {
      const storyPath = join(outDir, "results-story.png");
      await writeFile(storyPath, await toBuffer(story));
      // TikTok用の縦動画も作っておく(投稿は手動: TikTokは未監査アプリだと公開投稿できない)
      await makeSlideshow([storyPath], join(outDir, "video-results.mp4"), { duration: 6 });
    }

    text = composeResults(await loadResultsData(supabase, date));
    // 朝の予想ポストを引用RTして「後出しでない」ことを示す
    quoteTweetId = state[date]?.morning;
  } else {
    const title = mode === "evening" ? "あすの診断" : "きょうの診断";
    const res = await renderDigest(supabase, date, "og", title);
    if (!res) {
      await notify("SNS自動投稿を中止しました", `${date} ${mode}: 画像を生成できません`);
      process.exit(1);
    }
    imagePath = join(outDir, `digest-${mode}-og.png`);
    await writeFile(imagePath, await toBuffer(res));

    const previewData = await loadPreviewData(supabase, date);
    text = mode === "evening" ? composeEveningPreview(previewData) : composeMorningPreview(previewData);

    if (mode === "morning") {
      const story = await renderDigest(supabase, date, "story", title);
      if (story) {
        const storyPath = join(outDir, "digest-story.png");
        await writeFile(storyPath, await toBuffer(story));
        await makeSlideshow([storyPath], join(outDir, "video-preview.mp4"), { duration: 6 });
      }
    }
  }

  console.log(`--- 本文 (${describeLength(text)}) ---\n${text}`);

  // --- 4. 投稿 ---
  const result = await postToX({ text, imagePaths: [imagePath], quoteTweetId });

  // --- 5. 記録・通知 ---
  if (result.tweetId) {
    state[date] = { ...state[date], [mode]: result.tweetId };
    await saveState(state);
    console.log(`✅ 投稿しました: https://x.com/i/status/${result.tweetId}`);
    await notify("SNS自動投稿", `${date} ${mode} を投稿しました`);
  } else {
    console.log(`(dry-run のため投稿していません。画像: ${imagePath})`);
    await notify("SNS自動投稿(dry-run)", `${date} ${mode}: 生成完了、投稿はしていません`);
  }
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
