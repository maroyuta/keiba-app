import { jsonrepair } from "jsonrepair";
import { anthropic, CLAUDE_MODELS, extractText } from "./client";
import {
  STANDARD_SYSTEM_PROMPT,
  PREMIUM_SYSTEM_PROMPT,
  SCREENING_SYSTEM_PROMPT,
  buildRaceDataPayload,
  buildScreeningPayload,
  buildStandardPayload,
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
  try {
    return JSON.parse(cleaned) as T;
  } catch (firstErr) {
    // JSONが壊れていた場合の救済(2026-08-09、失敗根絶)。未終端文字列・途中切れ・制御文字混入などを
    // jsonrepairで機械修復してから再パースする。API再呼び出しは行わない=追加課金ゼロ、成功パスは不変。
    try {
      const parsed = JSON.parse(jsonrepair(cleaned)) as T;
      console.warn("[parseJsonResponse] 壊れたJSONをjsonrepairで修復して継続しました");
      return parsed;
    } catch {
      throw firstErr; // 修復も不可なら元のエラーを投げる(呼び出し側でusage記録→502)
    }
  }
}

// 一次スクリーニング (Haiku 4.5): 全レースをS〜Cで評価する軽量コール。
// Haiku 4.5はeffort/adaptive thinking非対応のため素の呼び出しにする。
//
// ⚠️2026-07-18、実運用のバッチ実行で稀に(35件中2件)Haikuが不正なJSON
// (文字列が途中で切れる等)を返し、その回のレース診断だけ丸ごと落ちる事象を確認した。
// max_tokensに対して十分小さい出力(150トークン程度)でも起きるため切り詰めではなく
// モデル側のフォーマット崩れと判断し、パース失敗時は1回だけ素直に再試行する。
export async function screenRace(
  input: RaceDiagnosisInput,
): Promise<{ result: ScreeningResult; usage: UsageInfo }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODELS.screening,
      max_tokens: 1024,
      system: SCREENING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildScreeningPayload(input) }],
    });
    try {
      return {
        result: parseJsonResponse<ScreeningResult>(extractText(message)),
        usage: buildUsageInfo(CLAUDE_MODELS.screening, message.usage),
      };
    } catch (err) {
      lastError = err;
      buildUsageInfo(CLAUDE_MODELS.screening, message.usage); // 失敗した回もコストは実際にかかっているので記録する
      console.warn(`[screenRace] JSONパース失敗(${attempt + 1}回目)、リトライします:`, err);
    }
  }
  throw lastError;
}

// LLMのJSON出力でoptionalな数値/文字列フィールド(honmei_horse_number等)が省略されると、
// JSON.parseはそのキーを持たないオブジェクトを返し、`as DiagnosisResult`キャストは型チェックを
// すり抜けて実行時にはJS undefinedになる(DiagnosisResultの型定義は`number | null`でundefinedを
// 想定していない)。route.tsのガード群(enforcePopularityGuard等)は`!== null`判定でundefinedを
// 見逃すため、素通りしたundefinedがそのままrace_rank_reasonの文字列に"undefined"として混入する
// 事故が起きた(2026-08-09、UHB賞でhonmei_horse_numberが有効なS評価の買い目を無効化した)。
// パース直後にここで一括してundefined→nullへ正規化し、以降の全コードが型定義(number | null)を
// 実際に信頼できる状態にする。
function normalizeDiagnosisResult(result: DiagnosisResult): DiagnosisResult {
  return {
    ...result,
    honmei_horse_number: result.honmei_horse_number ?? null,
    aite_horse_number: result.aite_horse_number ?? null,
    aite_horse_number_2: result.aite_horse_number_2 ?? null,
    bet_type: result.bet_type ?? null,
    bet_amount_wide: result.bet_amount_wide ?? null,
    bet_amount_umaren: result.bet_amount_umaren ?? null,
    bet_amount_wide_2: result.bet_amount_wide_2 ?? null,
    bet_amount_umaren_2: result.bet_amount_umaren_2 ?? null,
  };
}

// 診断レスポンスのJSONパースに失敗した時に投げるエラー。⚠️重要: standard/premiumは
// stream完走後にparseするため、parseが落ちても「Anthropicへのトークン課金は既に発生している」。
// このエラーにusageを載せて呼び出し側(route)へ渡し、失敗回もapi_usage_logに必ず記録させる
// (2026-08-09、中京5Rの失敗が課金されているのにログに残らず"見えない課金"になっていた事故対応)。
export class DiagnosisParseError extends Error {
  usage: UsageInfo;
  constructor(cause: unknown, usage: UsageInfo) {
    super(`診断レスポンスのJSONパースに失敗: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "DiagnosisParseError";
    this.usage = usage;
  }
}

// 標準診断表生成 (Sonnet 5): 通常レースの診断表 (枠・馬番・ランク・全体分析など)。
export async function diagnoseRaceStandard(
  input: RaceDiagnosisInput,
): Promise<{ result: DiagnosisResult; usage: UsageInfo }> {
  const stream = anthropic.messages.stream({
    model: CLAUDE_MODELS.standard,
    // 2026-08-02: 大頭数レース(札幌4R)でJSON途中切れ(Unterminated string)が再発。
    // 同日にCORE_RULESへanalysis_favorite/analysis_rivalの良い点・リスク両論併記を必須化する等
    // 出力を増やす変更を入れたため、16000では不足するケースが出てきたと見て余裕を持たせた。
    // max_tokensは天井であり実際の課金は使用トークン数のみに基づくため、上げること自体に追加コストは無い。
    max_tokens: 24000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    // プロンプトキャッシュ(2026-08-09): 巨大な共通ルール(STANDARD_SYSTEM_PROMPT)はレースをまたいで
    // 1バイトも変わらないため cache_control を付け、同一バッチ(diagnoseUpcoming等)の2レース目以降は
    // この前半を約1/10のコストで読み出す。レース固有データはuser messageに置いてあり前半に混ざらない
    // ため、キャッシュ(前方一致)は安全に効く。TTLはephemeral(5分)で、キャッシュヒットのたびに延長される
    // ため連続診断のバッチ内は温まったまま維持される。単発診断1回だけの時は書き込み1.25倍で微増だが、
    // 実運用のバッチではinput課金の共通部分が大幅に減る。
    system: [{ type: "text", text: STANDARD_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildStandardPayload(input) }],
  });
  const message = await stream.finalMessage();
  const usage = buildUsageInfo(CLAUDE_MODELS.standard, message.usage);
  try {
    const result = normalizeDiagnosisResult(parseJsonResponse<DiagnosisResult>(extractText(message)));
    return { result, usage };
  } catch (err) {
    throw new DiagnosisParseError(err, usage);
  }
}

// 重要レース診断 (Opus 4.8): race_rankがA/Sだったレースのみ、血統・調教まで含めたフル診断。
// ⚠️2026-07-18、effort:"xhigh"がVercel Hobbyプランの300秒上限(引き上げ不可、実機で確認済み)を
// 超えるケースが出た(マリーンS戦で300秒超過タイムアウト)。過去走・血統データが厚くなった分
// 処理時間も伸びたと見られる。
//
// effortは環境変数`PREMIUM_EFFORT`で切り替える(2026-07-18)。
//   - 未設定(=Vercel本番のデフォルト): "high"。300秒上限に確実に収める。スマホからボタン1つで
//     完結する経路を壊さないため。
//   - ローカルの`.env.local`で"xhigh": Mac上で`next dev`/`next start`を叩く経路には
//     maxDurationの制約が効かないため、Opusを全力(xhigh)で回せる。実際に金を張る数レースだけを
//     `npm run diagnose:premium`で全力診断する用途。バックテストで200〜400秒の完走実績あり。
// これにより「本気診断=Vercelの300秒に縛られてhighへ格下げ」という制約を、インフラ費0のまま
// ローカル経路でだけxhighに戻せる。
function premiumEffort(): "high" | "xhigh" {
  return process.env.PREMIUM_EFFORT === "xhigh" ? "xhigh" : "high";
}

export async function diagnoseRacePremium(
  input: RaceDiagnosisInput,
): Promise<{ result: DiagnosisResult; usage: UsageInfo }> {
  const stream = anthropic.messages.stream({
    model: CLAUDE_MODELS.premium,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: premiumEffort() },
    // プロンプトキャッシュ(2026-08-09、standardと同趣旨)。本気診断も共通ルールは固定なのでキャッシュする。
    system: [{ type: "text", text: PREMIUM_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildRaceDataPayload(input) }],
  });
  const message = await stream.finalMessage();
  const usage = buildUsageInfo(CLAUDE_MODELS.premium, message.usage);
  try {
    const result = normalizeDiagnosisResult(parseJsonResponse<DiagnosisResult>(extractText(message)));
    return { result, usage };
  } catch (err) {
    throw new DiagnosisParseError(err, usage);
  }
}
