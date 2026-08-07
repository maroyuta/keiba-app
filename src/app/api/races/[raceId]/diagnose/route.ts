import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { screenRace, diagnoseRaceStandard, diagnoseRacePremium } from "@/lib/claude/predict";
import type { UsageInfo } from "@/lib/claude/predict";
import type { RaceDiagnosisInput, DiagnosisResult, BiasReferenceRace } from "@/lib/claude/prompts";
import type { RaceRow, UsageLogTier } from "@/lib/supabase/database.types";
import { capDailySRank, capDailyBuyCandidates } from "@/lib/rank/capDailySRank";

// Sonnet(standard)は数十秒、Opus(premium, xhigh effort)は実測で約200秒かかることを確認済み。
// Vercel Hobbyプランはmaxduraiton上限が60秒で固定 (この値を超えて指定しても60秒でハードタイムアウトする)。
// premium診断はHobbyプランでは確実にタイムアウトするため、Proプラン(300秒、Fluid Computeで800秒まで
// 延長可)への切り替えが実質必須。詳細はAGENTS.mdの「開発ステータス」を参照。
// ⚠️Hobbyプランはmax 300で固定(800等を指定するとデプロイ自体が失敗することを実機で確認済み、
// 2026-07-18)。Proプランへの切り替えはユーザー判断の有料変更のためコード側では行わない。
// Vercel経由(このルート)のpremiumは effort=high に固定して300秒に収める。
//
// 「本気診断の全力(xhigh)」は Vercel ではなくローカル経路で回す(2026-07-18、方針A)。
// Mac上で `next dev`/`next start` を叩く経路には maxDuration の制約が効かないため、
// `.env.local` に PREMIUM_EFFORT=xhigh を入れて `npm run diagnose:premium -- --race <id>`
// (scripts/diagnosePremium.ts)で全力診断できる。effort切替は predict.ts の premiumEffort() 参照。
export const maxDuration = 300;

type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

// リサーチルール: 直近3走以上を精査する。余裕を持って5走分取得する。
const PAST_PERFORMANCE_LIMIT = 5;
// 調教評価は絶対タイムでなく直近セッションとの相対比較が目的のため、直近3回分で十分。
const TRAINING_SESSION_LIMIT = 3;

// 馬券方針「馬券対象は基本1〜9番人気に限定」はこれまでプロンプト上の指示のみで、コード側の
// enforcementが一切無かった(2026-07-14発覚)。バックテストで相手(aite)に実質16番人気
// (単勝オッズ81.7倍)の馬を選んでしまう事故があり、LLMの自己申告だけに委ねるのはリスクが高いと
// 判明したため、書き込み直前にコード側で機械的に検証するガードを追加する。
const MAX_BET_POPULARITY = 9;

// 相手(aite)は4番人気以下(=妙味帯)でなければ買わない。相手が1〜3番人気の「人気サイド同士」の
// 買い目は、実測で回収率が極端に低い(race_recommendation_results: 本命・相手とも1-3番人気の
// 組み合わせn=47で回収率48.1%/的中率21.3% ＝ よく当たるが配当が安すぎて大負け。一方、相手が
// 4-9番人気の妙味帯はn=370で87.0%)。この方針はこれまでプロンプト文言のみで、LLMが毎回
// 「堅い人気馬の方が信頼できる」と理屈をこねて回避してきた(2026-08-08、ユーザーが繰り返し指摘)。
// 昇級戦ガードと同じく、文章ではなく書き込み直前のハードブロックとして強制する。
// 本命(軸)は絶対能力重視で1〜3番人気から選ぶ設計のため対象外。相手側のみに適用する。
// 重賞は「race_rankによらず問答無用で購入」ルールが優先されるため、このガードからは除外する。
const MIN_AITE_POPULARITY = 4;

// expected_popularity(レース前オッズ由来、当日随時更新の速報値)が無いデータ(過去のバックテスト対象
// レース等)でも検証できるよう、odds_win昇順の順位をフォールバックとして常に併用する。
function buildOddsRankMap(input: RaceDiagnosisInput): Map<number, number> {
  const withOdds = input.entries
    .map((e) => ({ horseNumber: e.entry.horse_number, oddsWin: e.entry.odds_win }))
    .filter((e): e is { horseNumber: number; oddsWin: number } => e.oddsWin !== null)
    .sort((a, b) => a.oddsWin - b.oddsWin);
  const rankMap = new Map<number, number>();
  withOdds.forEach((e, i) => rankMap.set(e.horseNumber, i + 1));
  return rankMap;
}

function resolvePopularity(
  horseNumber: number,
  input: RaceDiagnosisInput,
  oddsRankMap: Map<number, number>,
): number | null {
  const entry = input.entries.find((e) => e.entry.horse_number === horseNumber);
  return entry?.entry.expected_popularity ?? oddsRankMap.get(horseNumber) ?? null;
}

// 買い目(honmei/aite)を実際にDBへ書き込む直前の最終安全装置。LLMの出力を無条件に信用せず、
// 人気(無ければオッズ順位)が想定範囲(1〜9番人気)を超えている、またはそもそも検証に必要な
// オッズデータが無い場合は、購入自体を機械的に見送りへ差し戻す。
function enforcePopularityGuard(
  input: RaceDiagnosisInput,
  result: DiagnosisResult,
): DiagnosisResult {
  const oddsRankMap = buildOddsRankMap(input);
  // 重賞(gradeあり)は「問答無用で購入」ルールが優先されるため、相手の人気下限(妙味帯)ガードは
  // かけない。相手が人気薄すぎ(>9)の天井ガードは重賞でも従来通り効かせる。
  const isGraded = !!input.race.grade;
  let updated = result;
  const violations: string[] = [];

  // 本命×相手1のどちらかが想定人気範囲外なら、この組み合わせ自体を丸ごと見送りにする
  // (相手2も本命が前提の買い目のため、本命が無効なら道連れでnullにする)。
  if (updated.honmei_horse_number !== null && updated.aite_horse_number !== null) {
    const honmeiPop = resolvePopularity(updated.honmei_horse_number, input, oddsRankMap);
    const aitePop = resolvePopularity(updated.aite_horse_number, input, oddsRankMap);
    const primaryViolations: string[] = [];
    if (honmeiPop === null || honmeiPop > MAX_BET_POPULARITY) {
      primaryViolations.push(`本命${updated.honmei_horse_number}番(推定${honmeiPop ?? "不明"}人気)`);
    }
    if (aitePop === null || aitePop > MAX_BET_POPULARITY) {
      primaryViolations.push(`相手${updated.aite_horse_number}番(推定${aitePop ?? "不明"}人気)`);
    } else if (!isGraded && aitePop < MIN_AITE_POPULARITY) {
      primaryViolations.push(
        `相手${updated.aite_horse_number}番(推定${aitePop}番人気=人気サイド、妙味帯${MIN_AITE_POPULARITY}番人気未満)`,
      );
    }
    if (primaryViolations.length > 0) {
      violations.push(...primaryViolations);
      updated = {
        ...updated,
        honmei_horse_number: null,
        aite_horse_number: null,
        aite_horse_number_2: null,
        bet_type: null,
        bet_amount_wide: null,
        bet_amount_umaren: null,
        bet_amount_wide_2: null,
        bet_amount_umaren_2: null,
      };
    }
  }

  // 相手2単独が人気範囲外の場合は、相手2だけをnullにする(本命×相手1はそのまま活かす)。
  if (updated.honmei_horse_number !== null && updated.aite_horse_number_2 !== null) {
    const aite2Pop = resolvePopularity(updated.aite_horse_number_2, input, oddsRankMap);
    const aite2TooPopular = !isGraded && aite2Pop !== null && aite2Pop < MIN_AITE_POPULARITY;
    if (aite2Pop === null || aite2Pop > MAX_BET_POPULARITY || aite2TooPopular) {
      const popLabel = aite2TooPopular
        ? `推定${aite2Pop}番人気=人気サイド、妙味帯${MIN_AITE_POPULARITY}番人気未満`
        : `推定${aite2Pop ?? "不明"}人気`;
      violations.push(`相手2 ${updated.aite_horse_number_2}番(${popLabel})`);
      updated = {
        ...updated,
        aite_horse_number_2: null,
        bet_amount_wide_2: null,
        bet_amount_umaren_2: null,
      };
    }
  }

  if (violations.length === 0) {
    return result;
  }

  console.warn(
    `[popularity-guard] 相手が妙味帯(${MIN_AITE_POPULARITY}〜${MAX_BET_POPULARITY}番人気)外のため購入を見送りに変更: ${violations.join(", ")}`,
  );
  return {
    ...updated,
    race_rank_reason: `${updated.race_rank_reason}\n[自動チェック] ${violations.join("、")}。相手は妙味帯(${MIN_AITE_POPULARITY}〜${MAX_BET_POPULARITY}番人気)から選ぶ必要があるため、購入を機械的に見送りへ変更した。`,
  };
}

// 馬券方針「昇級戦(今回のクラスで初めて走る馬)はaite候補にしない、原則除外」(prompts.ts参照)は
// これまでプロンプト上の指示のみで、コード側のenforcementが無かった。実際に未勝利上がりの馬が
// aiteに選ばれる違反が発生したため、MAX_BET_POPULARITY同様に書き込み直前の機械チェックを追加する。
// **2026-08-02午前、ユーザー指摘でhonmei/aite両方に拡大していたが、同日中に
// race_recommendation_results全期間の実データを検証した結果、「昇級馬を含む買い目」の回収率は
// 除外なしより高い(全期間n=396: 含む93.1% vs 含まない77.9%、2アイテ有無で分けても同傾向)ことが
// 判明。ただし直近100件だけで見ると逆転する(含む65.4% vs 含まない82.4%)等ノイズも大きく、
// 「昇級馬=買うべき/買うべきでない」を数字だけで決め切れる状態ではなかった。honmei(軸)は
// 「相手より情報の確度が高い場面で選ばれる」性質上、市場の人気自体が判断材料になるため実害が
// 見えにくいと判断し、ユーザーの意思で**honmei側の昇級ガードは撤廃**(自由に選んで良い)。
// aite(相手穴)側は「相当な理由があれば例外」という緩和も検討したが、honmeiが以前まさに
// この「圧倒的な内容なら例外」でLLMに際限なく理由をでっち上げられて機能しなかった前例と同じ
// リスクがあるため、**aite側は例外なしのハードブロックを維持**する。
// 判定はrace_class同士の一般的な序列比較ではなく、「取得済みの過去走(直近最大5走)のうち、今回の
// race_class(未勝利/新馬ではない)に該当しうる非未勝利/新馬の実績が1走以下(=今回が初戦または2戦目)」
// という狭いが確実なパターンに限定する(past_performances.race_classが未収録のため、race_name
// 文字列でのマッチに依る制約。1勝→2勝→3勝→OPのような、より上位クラス間の昇級は対象外)。
const MAIDEN_TIER_PATTERN = /未勝利|新馬/;
const MAX_NON_MAIDEN_STARTS_FOR_GUARD = 1;

function isEarlyClassUp(input: RaceDiagnosisInput, horseNumber: number): boolean {
  if (input.race.race_class && MAIDEN_TIER_PATTERN.test(input.race.race_class)) {
    return false;
  }
  const entry = input.entries.find((e) => e.entry.horse_number === horseNumber);
  if (!entry || entry.pastPerformances.length === 0) return false;
  const nonMaidenStarts = entry.pastPerformances.filter(
    (pp) => !!pp.race_name && !MAIDEN_TIER_PATTERN.test(pp.race_name),
  ).length;
  return nonMaidenStarts <= MAX_NON_MAIDEN_STARTS_FOR_GUARD;
}

// aiteに選ばれたかどうかに関わらず、出走馬一覧のカード自体にも昇級初戦・2戦目である旨を
// 表示する(2026-08-02、ユーザーが「全頭診断を参考に自分で買い目を組んだ」際に、見送りにした馬が
// horse_rank="S"のまま何の注記も無く表示され、結局その馬を買ってしまった事故を受けて追加)。
// race_rank_reasonへの注記だけでは出走馬カード単体を見た時に伝わらないため、該当馬自身の
// horse_rank_commentにも警告を追記する。honmei側のガードは同日中に撤廃したため、文言も
// 「相手としては原則除外」のみに変更し「軸として非推奨」は謳わない(honmeiに選ばれること自体は
// 問題ない)。
function annotateClassUpEntries(
  input: RaceDiagnosisInput,
  result: DiagnosisResult,
): DiagnosisResult {
  let annotatedAny = false;
  const entries = result.entries.map((entry) => {
    if (!isEarlyClassUp(input, entry.horse_number)) return entry;
    annotatedAny = true;
    return {
      ...entry,
      horse_rank_comment: `⚠️昇級初戦・2戦目(今回のクラスでの実績${MAX_NON_MAIDEN_STARTS_FOR_GUARD}走以下)のため相手としては原則除外対象。${entry.horse_rank_comment}`,
    };
  });
  if (!annotatedAny) return result;
  return { ...result, entries };
}

function enforceClassUpGuard(
  input: RaceDiagnosisInput,
  result: DiagnosisResult,
): DiagnosisResult {
  let updated = annotateClassUpEntries(input, result);
  const notes: string[] = [];

  // aite(1人目)が昇級初戦・2戦目に該当する場合のみ、買い目全体(honmei込み)を見送りにする。
  // honmeiだけ残しても本命→相手のペア馬券として成立しないため。honmei自体が昇級馬であることは
  // 2026-08-02のデータ検証(全期間で除外なしの方が回収率が高い)を受けて許容している。
  const aiteHit =
    updated.aite_horse_number !== null && isEarlyClassUp(input, updated.aite_horse_number);
  if (aiteHit) {
    notes.push(`相手${updated.aite_horse_number}番`);
    updated = {
      ...updated,
      honmei_horse_number: null,
      aite_horse_number: null,
      aite_horse_number_2: null,
      bet_type: null,
      bet_amount_wide: null,
      bet_amount_umaren: null,
      bet_amount_wide_2: null,
      bet_amount_umaren_2: null,
    };
  }

  if (updated.aite_horse_number_2 !== null && isEarlyClassUp(input, updated.aite_horse_number_2)) {
    notes.push(`相手2 ${updated.aite_horse_number_2}番`);
    updated = {
      ...updated,
      aite_horse_number_2: null,
      bet_amount_wide_2: null,
      bet_amount_umaren_2: null,
    };
  }

  if (notes.length === 0) {
    // honmei/aiteの見送り自体は発生しなかった場合でも、annotateClassUpEntriesによる
    // 出走馬カードへの注記(updated)は活かして返す(resultに巻き戻さない)。
    return updated;
  }

  console.warn(
    `[class-up-guard] race ${notes.join("、")}が昇級初戦・2戦目(非未勝利/新馬の実績${MAX_NON_MAIDEN_STARTS_FOR_GUARD}走以下)のため機械的に見送りへ変更`,
  );
  return {
    ...updated,
    race_rank_reason: `${updated.race_rank_reason}\n[自動チェック] ${notes.join("、")}は今回のクラスでの実績が1走以下(昇級初戦または2戦目)のため、機械的に見送りへ変更した。`,
  };
}

// 馬連はワイドよりオッズが高くなりやすい=的中率が低いため、馬連への配分を大きくしすぎない
// (2026-08-02、ユーザー指摘: 「馬連はほぼ当たらないので500円でほぼ固定、残りはワイドに」という
// 指示が過去にあったが、prompts.tsには「払戻額を揃える」という別の計算方式しか反映されておらず、
// 実際に馬連1,600円/1,900円のような配分が出ていた=指示が実装に反映されていなかった)。
// LLMに毎回按分計算をさせず、コード側で単純な固定配分として強制する。
const UMAREN_FIXED_AMOUNT = 500;
const BET_BUDGET_PER_AITE = 5000;

function applyFixedBetSplit(result: DiagnosisResult): DiagnosisResult {
  const updated = { ...result };
  if (updated.bet_type === "both") {
    if (updated.aite_horse_number !== null) {
      updated.bet_amount_umaren = UMAREN_FIXED_AMOUNT;
      updated.bet_amount_wide = BET_BUDGET_PER_AITE - UMAREN_FIXED_AMOUNT;
    }
    if (updated.aite_horse_number_2 !== null) {
      updated.bet_amount_umaren_2 = UMAREN_FIXED_AMOUNT;
      updated.bet_amount_wide_2 = BET_BUDGET_PER_AITE - UMAREN_FIXED_AMOUNT;
    }
  }
  return updated;
}

// トラックバイアスはその時の馬場状態次第のため、直近の実データを根拠にする。
// - 日曜のレース: [今週土曜の同場, 先週の同場] の最大2件を参照 (2026-07-13、ユーザー指摘により
//   土曜だけでなく先週分も追加。片方だけしか見つからない場合はあるものだけ返す)
// - それ以外 (基本的に土曜): 直近の同場開催 (先週の同場。開催初週なら前年以前の同時期開催まで遡る) を1件参照
// bias_noteが未診断でnullのレースは参照候補から除外する (診断済みレースのみが実データを持つため)。
async function findBiasReferenceRaces(
  supabase: SupabaseAdminClient,
  race: RaceRow,
): Promise<Array<{ id?: string; reference: BiasReferenceRace }>> {
  const raceDate = new Date(`${race.race_date}T00:00:00Z`);
  const dayOfWeek = raceDate.getUTCDay(); // 0=日, 6=土

  // actual_bias_note(post_position×finish_positionの実況集計、2026-08-01追加)がある場合は
  // bias_note(AIが診断時点で書いた"予測"バイアス)より優先する。過去の予測を参照レースとして
  // 積み上げると「予測の予測」で誤差が蓄積するため、実際に何が起きたかを優先的に使う。
  async function findMostRecentBefore(beforeDate: string) {
    const { data } = await supabase
      .from("races")
      .select("id, race_date, track_condition, bias_note, actual_bias_note")
      .eq("keibajo_code", race.keibajo_code)
      .neq("id", race.id)
      .or("bias_note.not.is.null,actual_bias_note.not.is.null")
      .lt("race_date", beforeDate)
      .order("race_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }

  async function findExact(dateStr: string) {
    const { data } = await supabase
      .from("races")
      .select("id, race_date, track_condition, bias_note, actual_bias_note")
      .eq("keibajo_code", race.keibajo_code)
      .neq("id", race.id)
      .eq("race_date", dateStr)
      .or("bias_note.not.is.null,actual_bias_note.not.is.null")
      .limit(1)
      .maybeSingle();
    return data;
  }

  function toResult(data: {
    id: string;
    race_date: string;
    track_condition: string | null;
    bias_note: string | null;
    actual_bias_note: string | null;
  }) {
    return {
      id: data.id,
      reference: {
        raceDate: data.race_date,
        trackCondition: data.track_condition,
        biasNote: data.actual_bias_note ?? data.bias_note,
      },
    };
  }

  const results: Array<{ id?: string; reference: BiasReferenceRace }> = [];

  if (dayOfWeek === 0) {
    const saturday = new Date(raceDate);
    saturday.setUTCDate(saturday.getUTCDate() - 1);
    const saturdayStr = saturday.toISOString().slice(0, 10);

    const satData = await findExact(saturdayStr);
    if (satData) results.push(toResult(satData));

    // 「先週」は今週土曜より前の直近レースを探す (race.race_date基準だと今週土曜自身を
    // 拾ってしまい重複するため、saturdayStrを起点にする)
    const lastWeekData = await findMostRecentBefore(saturdayStr);
    if (lastWeekData) results.push(toResult(lastWeekData));
  } else {
    const data = await findMostRecentBefore(race.race_date);
    if (data) results.push(toResult(data));
  }

  // 開催初週等で当シーズンの参照レース(AIがbias_noteを書いた実績)が1件も無い場合、
  // 過去の確定済みレース(race_entries.post_position/finish_position、複数年分あれば年をまたいでも可)
  // から機械的に「内枠/外枠どちらが残りやすいか」を集計し、非LLMのフォールバック根拠として補う。
  // LLMによる文章化コストが発生しないため無料。あくまで枠(post_position)の偏りのみを見る簡易指標で、
  // 脚質(コーナー通過順位)までは含まない点に注意(past_performancesの自己参照backfillが揃った後の課題)。
  if (results.length === 0) {
    const historical = await computeHistoricalBiasSignal(supabase, race);
    if (historical) {
      results.push({
        reference: {
          raceDate: `統計(過去${historical.sampleSize}走・複数レース集計、単一レースの実況ではない)`,
          trackCondition: null,
          biasNote: historical.summary,
        },
      });
    }
  }

  return results;
}

// 枠(post_position)と着順(finish_position)の相関から、内枠/外枠どちらが残りやすいかを
// 機械的に集計する。当シーズンの直近参照レースが無い(開催初週等)場合のみのフォールバック。
async function computeHistoricalBiasSignal(
  supabase: SupabaseAdminClient,
  race: RaceRow,
): Promise<{ sampleSize: number; summary: string } | null> {
  const { data: pastRaces } = await supabase
    .from("races")
    .select("id, entry_count")
    .eq("keibajo_code", race.keibajo_code)
    .eq("track_type", race.track_type)
    .neq("id", race.id)
    .lt("race_date", race.race_date)
    .not("entry_count", "is", null)
    .order("race_date", { ascending: false })
    .limit(40);

  const entryCountByRace = new Map((pastRaces ?? []).map((r) => [r.id, r.entry_count as number]));
  const raceIds = [...entryCountByRace.keys()];
  if (raceIds.length === 0) return null;

  const { data: entries } = await supabase
    .from("race_entries")
    .select("race_id, post_position, finish_position")
    .in("race_id", raceIds)
    .not("post_position", "is", null)
    .not("finish_position", "is", null)
    .gt("finish_position", 0);

  const innerFinishPcts: number[] = [];
  const outerFinishPcts: number[] = [];
  for (const e of entries ?? []) {
    const entryCount = entryCountByRace.get(e.race_id);
    if (!entryCount || !e.post_position || !e.finish_position) continue;
    const finishPct = e.finish_position / entryCount;
    const half = Math.ceil(entryCount / 2);
    if (e.post_position <= half) {
      innerFinishPcts.push(finishPct);
    } else {
      outerFinishPcts.push(finishPct);
    }
  }

  const sampleSize = innerFinishPcts.length + outerFinishPcts.length;
  // n不足時のノイズを避けるため、内外それぞれ最低20件は欲しい
  if (innerFinishPcts.length < 20 || outerFinishPcts.length < 20) return null;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const innerAvg = avg(innerFinishPcts);
  const outerAvg = avg(outerFinishPcts);
  const diff = outerAvg - innerAvg; // 正なら内枠有利(外枠の方が着順ペースが悪い)

  let trend: string;
  if (diff > 0.05) {
    trend = "内枠がやや有利な傾向";
  } else if (diff < -0.05) {
    trend = "外枠がやや有利な傾向";
  } else {
    trend = "枠による明確な差は見られない";
  }

  const innerPct = Math.round(innerAvg * 100);
  const outerPct = Math.round(outerAvg * 100);
  return {
    sampleSize,
    summary:
      `当シーズンの参照レースが無いため、過去${sampleSize}走(同場・同馬場種別、単年〜複数年の` +
      `確定済みレースの機械集計、AIによる文章化は経ていない生の統計値)から算出した枠順傾向: ` +
      `内枠(前半分の枠)の平均着順(頭数比)が${innerPct}%、外枠が${outerPct}%で、${trend}。` +
      `脚質(先行/差し)の傾向はこの集計に含まれないため、コース形態からの一般論と併用して判断すること。`,
  };
}

async function loadRaceDiagnosisInput(
  supabase: SupabaseAdminClient,
  raceId: string,
): Promise<{ input: RaceDiagnosisInput; biasReferenceRaceId: string | null } | null> {
  const { data: race } = await supabase.from("races").select("*").eq("id", raceId).single();
  if (!race) return null;

  const { data: entries } = await supabase
    .from("race_entries")
    .select("*, horses(*)")
    .eq("race_id", raceId);
  if (!entries || entries.length === 0) return null;

  const horseIds = entries.map((entry) => entry.horse_id);
  const entryIds = entries.map((entry) => entry.id);

  // race.race_date以降(当日含む)のpast_performancesは、同じ馬が対象レースより後に
  // 走った別レースの結果である可能性があり、「過去走」として見せると未来の結果が
  // 診断に漏れ込んでしまう(2026-07-12、七夕賞のテスト中に発覚)。対象レースより
  // 厳密に前の日付のみに絞る。
  const { data: pastPerformances } = await supabase
    .from("past_performances")
    .select("*")
    .in("horse_id", horseIds)
    .lt("race_date", race.race_date)
    .order("race_date", { ascending: false });

  const pastByHorse = new Map<string, NonNullable<typeof pastPerformances>>();
  for (const pp of pastPerformances ?? []) {
    const list = pastByHorse.get(pp.horse_id) ?? [];
    if (list.length < PAST_PERFORMANCE_LIMIT) {
      list.push(pp);
      pastByHorse.set(pp.horse_id, list);
    }
  }

  const { data: entryCriteriaScores } = await supabase
    .from("race_entry_criteria_scores")
    .select("*, prediction_criteria(*)")
    .in("race_entry_id", entryIds);

  const criteriaByEntry = new Map<
    string,
    Array<NonNullable<typeof entryCriteriaScores>[number]>
  >();
  for (const cs of entryCriteriaScores ?? []) {
    const list = criteriaByEntry.get(cs.race_entry_id) ?? [];
    list.push(cs);
    criteriaByEntry.set(cs.race_entry_id, list);
  }

  const { data: raceCriteriaScores } = await supabase
    .from("race_criteria_scores")
    .select("*, prediction_criteria(*)")
    .eq("race_id", raceId);

  // 血統 (horse_pedigrees): 馬1頭につき1行 (1:1)
  const { data: pedigrees } = await supabase
    .from("horse_pedigrees")
    .select("*")
    .in("horse_id", horseIds);

  const pedigreeByHorse = new Map<string, NonNullable<typeof pedigrees>[number]>();
  for (const pedigree of pedigrees ?? []) {
    pedigreeByHorse.set(pedigree.horse_id, pedigree);
  }

  // 調教 (training_sessions): 直近TRAINING_SESSION_LIMIT件/馬
  const { data: trainingSessions } = await supabase
    .from("training_sessions")
    .select("*")
    .in("horse_id", horseIds)
    .order("training_date", { ascending: false });

  const trainingByHorse = new Map<string, NonNullable<typeof trainingSessions>>();
  for (const session of trainingSessions ?? []) {
    const list = trainingByHorse.get(session.horse_id) ?? [];
    if (list.length < TRAINING_SESSION_LIMIT) {
      list.push(session);
      trainingByHorse.set(session.horse_id, list);
    }
  }

  // 種牡馬統計 (sire_stats) / 配合統計 (nick_stats): horses.sire_name/dam_sire_nameでテキストマッチ
  // (種牡馬自体がhorsesに行を持つとは限らないためFKではなくtextマッチ、AGENTS.md参照)
  // sireNamesが空でも.in()は0件で返るため、分岐せず常にクエリする。
  const sireNames = [...new Set(entries.map((entry) => entry.horses.sire_name).filter((v): v is string => !!v))];

  const { data: sireStats } = await supabase.from("sire_stats").select("*").in("sire_name", sireNames);
  const sireStatsByName = new Map<string, NonNullable<typeof sireStats>>();
  for (const stat of sireStats ?? []) {
    const list = sireStatsByName.get(stat.sire_name) ?? [];
    list.push(stat);
    sireStatsByName.set(stat.sire_name, list);
  }

  const { data: nickStats } = await supabase.from("nick_stats").select("*").in("sire_name", sireNames);
  const nickStatsByPair = new Map<string, NonNullable<typeof nickStats>>();
  for (const stat of nickStats ?? []) {
    const key = `${stat.sire_name}::${stat.dam_sire_name}`;
    const list = nickStatsByPair.get(key) ?? [];
    list.push(stat);
    nickStatsByPair.set(key, list);
  }

  // 騎手成績 (jockey_stats、2026-08-05新設): sire_stats/nick_statsと同じtextマッチ方式。
  const jockeyNames = [...new Set(entries.map((entry) => entry.jockey_name).filter((v): v is string => !!v))];
  const { data: jockeyStats } = await supabase.from("jockey_stats").select("*").in("jockey_name", jockeyNames);
  const jockeyStatsByName = new Map<string, NonNullable<typeof jockeyStats>>();
  for (const stat of jockeyStats ?? []) {
    const list = jockeyStatsByName.get(stat.jockey_name) ?? [];
    list.push(stat);
    jockeyStatsByName.set(stat.jockey_name, list);
  }

  // 厩舎の坂路タイムベースライン (trainer_training_baselines、2026-08-05新設)。
  // race_entries.trainer_name(レース時点のスナップショット)でマッチする。
  const trainerNames = [...new Set(entries.map((entry) => entry.trainer_name).filter((v): v is string => !!v))];
  const { data: trainerBaselines } = await supabase
    .from("trainer_training_baselines")
    .select("*")
    .in("trainer_name", trainerNames);
  const trainerBaselineByName = new Map<string, NonNullable<typeof trainerBaselines>[number]>();
  for (const baseline of trainerBaselines ?? []) {
    // training_type違いが複数件ありうるが、現状「坂路」しか実装していないため単純に上書きでよい
    // (WOOD実装後、複数件を返すよう拡張する場合はMap<string, Row[]>に変更すること)。
    trainerBaselineByName.set(baseline.trainer_name, baseline);
  }

  const biasReferences = await findBiasReferenceRaces(supabase, race);

  // ワイド・馬連の現在オッズ(組み合わせ単位、JV-Link JVRTOpen "0B30"由来、2026-07-31追加)。
  // 発売開始前や取得タイミング次第では0件のこともあり、その場合はプロンプト側で単勝オッズ
  // からの概算にフォールバックする。
  const { data: oddsCombinations } = await supabase
    .from("race_odds_combinations")
    .select("*")
    .eq("race_id", raceId);

  return {
    input: {
      race,
      entries: entries.map((entry) => ({
        entry,
        horse: entry.horses,
        pastPerformances: pastByHorse.get(entry.horse_id) ?? [],
        criteriaScores: (criteriaByEntry.get(entry.id) ?? []).map((cs) => ({
          ...cs,
          criteria: cs.prediction_criteria,
        })),
        pedigree: pedigreeByHorse.get(entry.horse_id) ?? null,
        trainingSessions: trainingByHorse.get(entry.horse_id) ?? [],
        sireStats: entry.horses.sire_name ? (sireStatsByName.get(entry.horses.sire_name) ?? []) : [],
        nickStats: entry.horses.sire_name && entry.horses.dam_sire_name
          ? (nickStatsByPair.get(`${entry.horses.sire_name}::${entry.horses.dam_sire_name}`) ?? [])
          : [],
        jockeyStats: entry.jockey_name ? (jockeyStatsByName.get(entry.jockey_name) ?? []) : [],
        trainerBaseline: entry.trainer_name ? (trainerBaselineByName.get(entry.trainer_name) ?? null) : null,
      })),
      raceCriteriaScores: (raceCriteriaScores ?? []).map((rc) => ({
        ...rc,
        criteria: rc.prediction_criteria,
      })),
      biasReferenceRaces: biasReferences.map((r) => r.reference),
      oddsCombinations: oddsCombinations ?? [],
    },
    // DBのbias_reference_race_id(単一FK)には、参照した中で最初の1件(日曜なら今週土曜、
    // 無ければ先週分)だけを記録する。プロンプトへは全件渡す。
    biasReferenceRaceId: biasReferences[0]?.id ?? null,
  };
}

async function logUsage(
  supabase: SupabaseAdminClient,
  raceId: string,
  tier: UsageLogTier,
  usage: UsageInfo,
): Promise<void> {
  const { error } = await supabase.from("api_usage_log").insert({
    race_id: raceId,
    tier,
    model: usage.model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_creation_input_tokens: usage.cacheCreationInputTokens,
    cache_read_input_tokens: usage.cacheReadInputTokens,
    estimated_cost_usd: usage.estimatedCostUsd,
  });
  if (error) {
    console.warn(`[usage] api_usage_log書き込み失敗 (${tier}):`, error.message);
  }
}

// 少頭数(11頭以下)・極端な鉄板(1番人気が1.5倍未満)のレースは妙味が出ないため購入見送り、という
// 馬券方針(RACE_RANK_RULES/SCREENING参照)は、これまでプロンプト指示のみで機械的enforcementが無かった。
// プロンプト文言とコードのズレ(昇級ガードで実害が出た)の再発防止として、書き込み直前にコードでも強制する
// (2026-08-08、ユーザー指示でハードコード化)。重賞は「race_rankによらず問答無用で購入」ルールが
// 優先されるため、このガードからは除外する。
const SMALL_FIELD_MAX = 11;
const EXTREME_FAVORITE_ODDS = 1.5;

function enforceRaceViabilityGuard(
  input: RaceDiagnosisInput,
  result: DiagnosisResult,
): DiagnosisResult {
  if (input.race.grade) return result; // 重賞は対象外(必ず購入)
  if (result.honmei_horse_number === null && result.aite_horse_number === null) return result;
  const reasons: string[] = [];
  const entryCount = input.race.entry_count;
  if (entryCount !== null && entryCount <= SMALL_FIELD_MAX) {
    reasons.push(`少頭数(${entryCount}頭≤${SMALL_FIELD_MAX}頭)`);
  }
  const oddsList = input.entries
    .map((e) => e.entry.odds_win)
    .filter((o): o is number => o !== null);
  if (oddsList.length > 0) {
    const favoriteOdds = Math.min(...oddsList);
    if (favoriteOdds < EXTREME_FAVORITE_ODDS) {
      reasons.push(`極端な鉄板(1番人気${favoriteOdds}倍<${EXTREME_FAVORITE_ODDS}倍)`);
    }
  }
  if (reasons.length === 0) return result;
  console.warn(`[viability-guard] ${reasons.join("・")}のため購入を見送り・race_rank=Cに変更`);
  return {
    ...result,
    race_rank: "C",
    honmei_horse_number: null,
    aite_horse_number: null,
    aite_horse_number_2: null,
    bet_type: null,
    bet_amount_wide: null,
    bet_amount_umaren: null,
    bet_amount_wide_2: null,
    bet_amount_umaren_2: null,
    race_rank_reason: `${result.race_rank_reason}\n[自動チェック] ${reasons.join("・")}のため、race_rankをCとし購入を機械的に見送りへ変更した(重賞を除く)。`,
  };
}

async function persistDiagnosis(
  supabase: SupabaseAdminClient,
  raceId: string,
  input: RaceDiagnosisInput,
  rawResult: DiagnosisResult,
  biasReferenceRaceId: string | null,
  tier: UsageLogTier,
): Promise<void> {
  const result = applyFixedBetSplit(
    enforceRaceViabilityGuard(
      input,
      enforcePopularityGuard(input, enforceClassUpGuard(input, rawResult)),
    ),
  );
  await supabase
    .from("races")
    .update({
      race_rank: result.race_rank,
      race_rank_reason: result.race_rank_reason,
      race_priority_score: result.race_priority_score,
      // 「本気診断できてるか自分で判断つかない」への対応(2026-07-19)。premiumが実際に
      // 完走・コミットされた時刻を記録し、UIの済バッジ表示に使う。
      ...(tier === "premium" ? { premium_diagnosed_at: new Date().toISOString() } : {}),
      bias_note: result.predicted_bias,
      bias_reference_race_id: biasReferenceRaceId,
      honmei_horse_number: result.honmei_horse_number,
      aite_horse_number: result.aite_horse_number,
      aite_horse_number_2: result.aite_horse_number_2,
      bet_type: result.bet_type,
      bet_amount_wide: result.bet_amount_wide,
      bet_amount_umaren: result.bet_amount_umaren,
      bet_amount_wide_2: result.bet_amount_wide_2,
      bet_amount_umaren_2: result.bet_amount_umaren_2,
      analysis_level: result.analysis_level,
      analysis_favorite: result.analysis_favorite,
      analysis_rival: result.analysis_rival,
      analysis_value: result.analysis_value,
      analysis_pace: result.analysis_pace,
    })
    .eq("id", raceId);

  const entryIdByHorseNumber = new Map(
    input.entries.map((e) => [e.entry.horse_number, e.entry.id]),
  );

  await Promise.all(
    result.entries.map((entryResult) => {
      const entryId = entryIdByHorseNumber.get(entryResult.horse_number);
      if (!entryId) return Promise.resolve();
      return supabase
        .from("race_entries")
        .update({
          horse_rank: entryResult.horse_rank,
          horse_rank_comment: entryResult.horse_rank_comment,
          is_kesshi: entryResult.is_kesshi,
          kesshi_reason: entryResult.kesshi_reason,
        })
        .eq("id", entryId);
    }),
  );

  // このレースがS/Aを付けた/維持した結果、当日の件数が上限を超えていれば
  // race_priority_score順で下位を機械的に格下げする(2026-07-19、ユーザー指示)。
  // 先にSの上限(→A格下げ)を確定させてから、S+A合計の上限(→B格下げ)を数える。
  if (result.race_rank === "S" || result.race_rank === "A") {
    await capDailySRank(supabase, input.race.race_date);
    await capDailyBuyCandidates(supabase, input.race.race_date);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ raceId: string }> },
) {
  const { raceId } = await context.params;
  const supabase = createAdminClient();
  const wantsPremium = new URL(request.url).searchParams.get("tier") === "premium";

  const loaded = await loadRaceDiagnosisInput(supabase, raceId);
  if (!loaded) {
    return NextResponse.json({ error: "race not found" }, { status: 404 });
  }
  const { input, biasReferenceRaceId } = loaded;

  // 「本気診断」ボタン: standardでA/S評価が出たレースのみ、手動でOpusへ深掘りさせる
  // (2026-07-13、S限定からA以上に緩和。standardは血統/調教を見ない軽量tierになったため、
  // 実際の深掘り調査はA以上のレース全てでpremiumに任せる二段階構成にした)。
  // 未勝利・新馬戦はA/S評価が出てもOpusへはエスカレーションさせず、Sonnet(standard)止まりにする
  // (新馬戦は下のscreening前スキップで元々standardにも到達しないが、念のためここでも明示的に弾く)。
  // 重賞はrace_rankによらず対象にする(2026-07-13、バグ修正: 「重賞は問答無用で購入・予算12,000円」の
  // 対象なのに、race_rankがB/Cだと本気診断の対象から外れてしまう矛盾があった。最も金額の大きい
  // 賭けになるレースほど深掘り調査から漏れる、という逆転を防ぐ)。
  if (wantsPremium) {
    if (input.race.race_class?.includes("未勝利") || input.race.race_class?.includes("新馬")) {
      return NextResponse.json(
        { error: "未勝利・新馬戦は本気診断(Opus)の対象外です" },
        { status: 400 },
      );
    }
    const isGradedForPremium = input.race.grade !== null;
    if (!isGradedForPremium && input.race.race_rank !== "S" && input.race.race_rank !== "A") {
      return NextResponse.json(
        { error: "本気診断はA評価以上、または重賞のレースのみ実行できます" },
        { status: 400 },
      );
    }
    const premium = await diagnoseRacePremium(input);
    await logUsage(supabase, raceId, "premium", premium.usage);
    await persistDiagnosis(supabase, raceId, input, premium.result, biasReferenceRaceId, "premium");
    return NextResponse.json({ tier: "premium", result: premium.result });
  }

  // 障害レース・新馬戦・未勝利戦はコスト対象外 (screeningのHaiku呼び出しすら行わない)。
  // 未勝利は2026-07-13にユーザーが追加(基本的に馬券を買わないクラスのため)。
  // どちらもload_to_supabase.pyのjyoken_cd由来race_class修正が前提(修正前はrace_classが
  // 常にnullで、この判定が実質機能していなかった)。
  if (input.race.track_type === "障害") {
    return NextResponse.json({ tier: "skipped", reason: "障害レースは診断対象外" });
  }
  if (input.race.race_class?.includes("新馬")) {
    return NextResponse.json({ tier: "skipped", reason: "新馬戦は診断対象外" });
  }
  if (input.race.race_class?.includes("未勝利")) {
    return NextResponse.json({ tier: "skipped", reason: "未勝利戦は診断対象外" });
  }

  // 重賞(grade設定あり)は「問答無用で購入する」対象のため、少頭数チェックにもscreeningの
  // C足切りにも一切かからないようにする(2026-07-13、ユーザー指摘)。実際の購入判断
  // (予算12,000円への変更含む)はSTANDARD/PREMIUM_SYSTEM_PROMPTの「重賞は問答無用で購入する」
  // 節に委ねる。
  const isGraded = input.race.grade !== null;

  // 少頭数レース(11頭以下)は払い戻しに期待できないため、screening(Haikuの費用)すら呼ばず
  // 機械的にrace_rank=Cとする(2026-07-13、ユーザー指摘。「見送り」ではなく明示的にC評価として
  // 記録する点が上の3つのskip対象と異なる)。重賞は対象外(下記isGraded除外)。
  const SMALL_FIELD_MAX_ENTRIES = 11;
  if (!isGraded && input.race.entry_count !== null && input.race.entry_count <= SMALL_FIELD_MAX_ENTRIES) {
    const reason = `少頭数(${input.race.entry_count}頭、11頭以下)のため馬券対象外`;
    await supabase
      .from("races")
      .update({ race_rank: "C", race_rank_reason: reason, bias_reference_race_id: biasReferenceRaceId })
      .eq("id", raceId);
    return NextResponse.json({ tier: "screening", race_rank: "C", race_rank_reason: reason });
  }

  // 一次スクリーニング (Haiku) でC評価なら、コスト削減のためここで打ち切る。
  // 重賞はscreening自体をスキップしてstandardへ直行する(C評価で打ち切られると
  // honmei/aiteが生成されず「問答無用で購入」を実現できないため)。
  if (!isGraded) {
    const screening = await screenRace(input);
    await logUsage(supabase, raceId, "screening", screening.usage);
    if (screening.result.race_rank === "C") {
      await supabase
        .from("races")
        .update({
          race_rank: screening.result.race_rank,
          race_rank_reason: screening.result.race_rank_reason,
          bias_reference_race_id: biasReferenceRaceId,
        })
        .eq("id", raceId);
      return NextResponse.json({
        tier: "screening",
        race_rank: screening.result.race_rank,
        race_rank_reason: screening.result.race_rank_reason,
      });
    }
  }

  // 重賞(grade設定あり)は必ずOpus(premium)で診断する(2026-07-18、ユーザー指示「重賞は確定でopus」)。
  // 最も大きい金額を張るレースなので、standard止まりにせず自動でpremiumへ escalate する。
  // Vercel経由ではeffort=high(300秒上限内)、ローカルのnpm run diagnose:premium経由ではxhigh全力になる
  // (predict.tsのpremiumEffort()参照)。平場のS/A評価は従来通り「本気診断」ボタンの手動実行に委ねる。
  if (isGraded) {
    const premium = await diagnoseRacePremium(input);
    await logUsage(supabase, raceId, "premium", premium.usage);
    await persistDiagnosis(supabase, raceId, input, premium.result, biasReferenceRaceId, "premium");
    return NextResponse.json({ tier: "premium", result: premium.result });
  }

  // 標準診断 (Sonnet)。S評価が出ても自動ではOpusへ進まず、「本気診断」ボタンの手動実行に委ねる。
  const diagnosis = await diagnoseRaceStandard(input);
  await logUsage(supabase, raceId, "standard", diagnosis.usage);
  await persistDiagnosis(supabase, raceId, input, diagnosis.result, biasReferenceRaceId, "standard");

  return NextResponse.json({ tier: "standard", result: diagnosis.result });
}
