import { readFileSync } from "fs";

// Pythonスクリプト側(scripts/jvlink/load_to_supabase.py)のload_env_file()と同じ設計。
// Windowsタスクスケジューラ等、シェルでの`source`が使えない環境から実行するために、
// `--env-file <path>`で.env.local等のファイルを直接読み込めるようにする。
// 既に設定済みの環境変数は上書きしない(process.env優先)。
export function loadEnvFileFromArgs(argv: string[]): string[] {
  const idx = argv.indexOf("--env-file");
  if (idx === -1) return argv;

  const path = argv[idx + 1];
  if (!path) {
    throw new Error("--env-file にはファイルパスを指定してください");
  }

  const content = readFileSync(path, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
    if (!(key.trim() in process.env)) {
      process.env[key.trim()] = value;
    }
  }

  return [...argv.slice(0, idx), ...argv.slice(idx + 2)];
}
