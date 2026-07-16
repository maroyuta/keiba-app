import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // subset-font(SNSシェア画像のフォントサブセット化)はharfbuzzjsのwasmを
  // 実行時にreadFileするため、バンドルするとwasmのパスが壊れて500になる。
  // Nodeのrequireでそのまま読ませる。
  serverExternalPackages: ["subset-font", "harfbuzzjs"],
  // Vercelのserverless関数はデフォルトでは動的readFileの対象を追跡できないため、
  // /api/sns/* が読むフォントを明示的にバンドルへ含める
  outputFileTracingIncludes: {
    "/api/sns/**": ["./assets/fonts/*.otf"],
  },
};

export default nextConfig;
