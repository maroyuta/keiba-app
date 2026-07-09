import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic();

// コスト最適化のためのモデル階層。
// screening: 全レース一次スクリーニング (Haiku 4.5)
// standard: 標準レースの診断表生成 (Sonnet 5)
// premium: 「本気で買う」判定レースのみ (Opus 4.8)
export const CLAUDE_MODELS = {
  screening: "claude-haiku-4-5",
  standard: "claude-sonnet-5",
  premium: "claude-opus-4-8",
} as const;

export type ClaudeTier = keyof typeof CLAUDE_MODELS;

export function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}
