import { anthropic, CLAUDE_MODELS, extractText } from "./client";
import {
  DIAGNOSIS_SYSTEM_PROMPT,
  SCREENING_SYSTEM_PROMPT,
  buildRaceDataPayload,
  type RaceDiagnosisInput,
  type DiagnosisResult,
  type ScreeningResult,
} from "./prompts";

// 2026-07時点の1Mトークンあたり料金 (USD)。Sonnet 5はintro価格 (2026-08-31まで、以降$3/$15)。
// adaptive thinkingのトークンは別立てではなく通常のoutputと同じ単価で課金される。
const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
};

interface RawUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface UsageInfo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  estimatedCostUsd: number;
}

function estimateCostUsd(model: string, usage: RawUsage): number {
  const pricing = PRICING_USD_PER_MTOK[model];
  if (!pricing) return 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;
  // cache_control未使用のためcreation/readは通常0だが、将来のキャッシュ導入に備えて計算しておく。
  const cacheCreationCost = (cacheCreation / 1_000_000) * pricing.input * 1.25;
  const cacheReadCost = (cacheRead / 1_000_000) * pricing.input * 0.1;
  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

function buildUsageInfo(model: string, usage: RawUsage): UsageInfo {
  const info: UsageInfo = {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    estimatedCostUsd: estimateCostUsd(model, usage),
  };
  console.log(
    `[usage] ${model}: input=${info.inputTokens} output=${info.outputTokens} ` +
      `cost=$${info.estimatedCostUsd.toFixed(4)} (≈¥${(info.estimatedCostUsd * 150).toFixed(1)})`,
  );
  return info;
}

// Claudeの出力は素のJSONを指示しているが、念のためコードフェンスが付いた場合に備えて剥がす。
function parseJsonResponse<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

// 一次スクリーニング (Haiku 4.5): 全レースをS〜Cで評価する軽量コール。
// Haiku 4.5はeffort/adaptive thinking非対応のため素の呼び出しにする。
export async function screenRace(
  input: RaceDiagnosisInput,
): Promise<{ result: ScreeningResult; usage: UsageInfo }> {
  const message = await anthropic.messages.create({
    model: CLAUDE_MODELS.screening,
    max_tokens: 1024,
    system: SCREENING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildRaceDataPayload(input) }],
  });
  return {
    result: parseJsonResponse<ScreeningResult>(extractText(message)),
    usage: buildUsageInfo(CLAUDE_MODELS.screening, message.usage),
  };
}

// 標準診断表生成 (Sonnet 5): 通常レースの診断表 (枠・馬番・ランク・全体分析など)。
export async function diagnoseRaceStandard(
  input: RaceDiagnosisInput,
): Promise<{ result: DiagnosisResult; usage: UsageInfo }> {
  const stream = anthropic.messages.stream({
    model: CLAUDE_MODELS.standard,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: DIAGNOSIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildRaceDataPayload(input) }],
  });
  const message = await stream.finalMessage();
  return {
    result: parseJsonResponse<DiagnosisResult>(extractText(message)),
    usage: buildUsageInfo(CLAUDE_MODELS.standard, message.usage),
  };
}

// 重要レース診断 (Opus 4.8): 「本気で買う」と判定したレースのみのフル診断。
export async function diagnoseRacePremium(
  input: RaceDiagnosisInput,
): Promise<{ result: DiagnosisResult; usage: UsageInfo }> {
  const stream = anthropic.messages.stream({
    model: CLAUDE_MODELS.premium,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "xhigh" },
    system: DIAGNOSIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildRaceDataPayload(input) }],
  });
  const message = await stream.finalMessage();
  return {
    result: parseJsonResponse<DiagnosisResult>(extractText(message)),
    usage: buildUsageInfo(CLAUDE_MODELS.premium, message.usage),
  };
}
