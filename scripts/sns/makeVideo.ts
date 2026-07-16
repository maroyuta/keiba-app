import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

// 縦型(1080x1920)スライドショー動画を生成する。TikTok/リール/ショート用。
// 各画像をduration秒表示し、fade秒のクロスフェードで繋ぐ。音声なし
// (BGMはTikTok側でトレンド音源を付ける方が伸びる+権利的にも安全なため)。
export async function makeSlideshow(
  images: string[],
  outPath: string,
  opts: { duration?: number; fade?: number } = {}
): Promise<void> {
  if (images.length === 0) {
    throw new Error("画像が1枚も指定されていません");
  }
  const duration = opts.duration ?? 3.5;
  const fade = opts.fade ?? 0.6;

  const args: string[] = ["-y"];
  for (const img of images) {
    args.push("-loop", "1", "-t", String(duration), "-i", img);
  }

  const prep = images
    .map(
      (_, i) =>
        `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#0b1a17,setsar=1,fps=30[v${i}]`
    )
    .join(";");

  let filter = prep;
  let lastLabel = "v0";
  for (let i = 1; i < images.length; i++) {
    const offset = i * (duration - fade);
    const outLabel = i === images.length - 1 ? "vout" : `x${i}`;
    filter += `;[${lastLabel}][v${i}]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(2)}[${outLabel}]`;
    lastLabel = outLabel;
  }
  if (images.length === 1) {
    filter += `;[v0]copy[vout]`;
  }

  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outPath
  );

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as unknown as string, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

// 単体実行: npx tsx scripts/sns/makeVideo.ts --out out.mp4 --images a.png b.png c.png
async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const imagesIdx = argv.indexOf("--images");
  if (outIdx === -1 || imagesIdx === -1) {
    console.error("使い方: npx tsx scripts/sns/makeVideo.ts --out out.mp4 --images a.png b.png ...");
    process.exit(1);
  }
  const out = argv[outIdx + 1];
  const images = argv.slice(imagesIdx + 1).filter((a) => !a.startsWith("--"));
  await makeSlideshow(images, out);
  console.log(`✅ ${out} (${images.length}枚)`);
}

if (process.argv[1]?.endsWith("makeVideo.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
