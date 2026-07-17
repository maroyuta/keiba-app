import { readFile } from "node:fs/promises";
import { EUploadMimeType, TwitterApi } from "twitter-api-v2";

// X(Twitter)自動投稿クライアント。
//
// 認証はOAuth 1.0a(ユーザーコンテキスト)。X_で始まる4つの環境変数が
// 揃っていない場合は必ずdry-run(実際には投稿せずログ出力のみ)になる。
// 鍵の取得手順はdocs/sns-automation.md参照。
//
// 課金: 2026年2月に無料枠が廃止され、投稿は約$0.015/件の従量課金
// (週13投稿なら月$1弱)。実際の請求はX側のダッシュボードで確認すること。

export type PostInput = {
  text: string;
  imagePaths?: string[];
  // 指定するとそのツイートの引用として投稿する(結果報告→朝の予想の引用RT用)
  quoteTweetId?: string;
};

export type PostOutput = {
  tweetId: string | null;
  dryRun: boolean;
};

function readCredentials() {
  const appKey = process.env.X_API_KEY;
  const appSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_SECRET;
  if (!appKey || !appSecret || !accessToken || !accessSecret) return null;
  return { appKey, appSecret, accessToken, accessSecret };
}

export function isConfigured(): boolean {
  return readCredentials() !== null;
}

// X_DRY_RUN=1 が設定されていれば、鍵があっても投稿しない(テスト用)
function isDryRun(): boolean {
  return process.env.X_DRY_RUN === "1" || !isConfigured();
}

export async function postToX(input: PostInput): Promise<PostOutput> {
  if (isDryRun()) {
    const why = isConfigured() ? "X_DRY_RUN=1" : "X_*の環境変数が未設定";
    console.log(`[dry-run] 投稿しません (${why})`);
    console.log(`--- 本文 (${[...input.text].length}字) ---\n${input.text}`);
    if (input.imagePaths?.length) console.log(`--- 添付 ---\n${input.imagePaths.join("\n")}`);
    if (input.quoteTweetId) console.log(`--- 引用元 --- ${input.quoteTweetId}`);
    return { tweetId: null, dryRun: true };
  }

  const creds = readCredentials()!;
  const client = new TwitterApi(creds);

  // メディアアップロードはv2(POST /2/media/upload)を優先する。
  // v1.1のmedia/uploadは廃止方向で、従量課金移行後のプランでは弾かれる場合があるため、
  // v2が失敗したときのみv1.1にフォールバックする。
  const mediaIds: string[] = [];
  for (const path of (input.imagePaths ?? []).slice(0, 4)) {
    let mediaId: string;
    try {
      const buffer = await readFile(path);
      mediaId = await client.v2.uploadMedia(buffer, {
        media_type: EUploadMimeType.Png,
        media_category: "tweet_image",
      });
    } catch (err) {
      console.warn(`v2のメディアアップロードに失敗、v1.1で再試行します: ${(err as Error).message}`);
      mediaId = await client.v1.uploadMedia(path);
    }
    mediaIds.push(mediaId);
  }

  const payload: Parameters<typeof client.v2.tweet>[0] = { text: input.text };
  if (mediaIds.length > 0) {
    payload.media = { media_ids: mediaIds as [string] };
  }
  if (input.quoteTweetId) {
    payload.quote_tweet_id = input.quoteTweetId;
  }

  const res = await client.v2.tweet(payload);
  return { tweetId: res.data.id, dryRun: false };
}

// Xの日本語カウントは1文字=2 weighted chars、上限280 weighted(=全角140字)。
// URLは一律23 weighted chars扱い。半角英数は1。厳密ではないが実用上十分な近似。
export function weightedLength(text: string): number {
  const urlPattern = /https?:\/\/\S+/g;
  const urls = text.match(urlPattern) ?? [];
  const withoutUrls = text.replace(urlPattern, "");
  let weight = urls.length * 23;
  for (const ch of withoutUrls) {
    const code = ch.codePointAt(0)!;
    // 半角英数・記号・改行は1、それ以外(日本語等)は2
    weight += code <= 0x10ff || (code >= 0x2000 && code <= 0x200a) ? 1 : 2;
  }
  return weight;
}

export const X_MAX_WEIGHT = 280;

export function fitsInTweet(text: string): boolean {
  return weightedLength(text) <= X_MAX_WEIGHT;
}
