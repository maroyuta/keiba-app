import { createNetkeibaSyncClient } from "./netkeiba/supabaseClient";
import { loadEnvFileFromArgs } from "./netkeiba/loadEnvFile";

// 診断後QAチェック。指定日の診断済み全レースを走査し、ハードな馬券ルールへの違反を機械的に検出する。
// 目的: 2026-08-08にSapporo4R/新潟11Rで起きた「昇級戦を理由に本命(1-3番人気)を誤除外」バグや
// 「相手が人気サイド」「データ不足馬を採用」等が、目視の見落としで素通りするのを防ぐ。
// これはenforce系ガードの"事後監査"であり、ガードをすり抜けた/プロンプト起因の異常も拾う。
// 読み取り専用でDBは変更しない。diagnose:upcomingの後に必ず回す運用。
// 使い方: npm run check:diagnosis -- --date YYYY-MM-DD [--env-file <path>]

const EXTREME_FAVORITE_ODDS = 1.5;
const SMALL_FIELD_MAX = 11;

async function main() {
  const args = loadEnvFileFromArgs(process.argv.slice(2));
  const dateIdx = args.indexOf("--date");
  const date = dateIdx !== -1 ? args[dateIdx + 1] : null;
  if (!date) {
    console.error("使い方: npm run check:diagnosis -- --date YYYY-MM-DD [--env-file <path>]");
    process.exit(1);
  }

  const supabase = createNetkeibaSyncClient();
  const { data: races, error } = await supabase
    .from("races")
    .select(
      "id, keibajo_name, race_number, race_rank, race_rank_reason, grade, entry_count, honmei_horse_number, aite_horse_number, aite_horse_number_2",
    )
    .eq("race_date", date)
    .not("race_rank", "is", null)
    .order("keibajo_name")
    .order("race_number");
  if (error) throw new Error(`races取得失敗: ${error.message}`);
  if (!races || races.length === 0) {
    console.log(`[check] ${date}: 診断済みレースが見つかりません`);
    return;
  }

  const findings: string[] = [];

  for (const r of races) {
    const label = `${r.keibajo_name ?? ""}${r.race_number}R`;
    const graded = !!r.grade;
    const reason = r.race_rank_reason ?? "";

    // 昇級戦を理由に本命を誤除外していないか(本命側の昇級ガードは撤廃済み。相手のみが正しい)。
    // 旧バグの診断文は "honmei/aite対象外" と書く傾向があるため、それを主な手掛かりにする。
    if (
      /昇級|未勝利卒業/.test(reason) &&
      /honmei\/aite|本命.{0,8}(対象外|除外|外す)|(対象外|除外).{0,8}本命/.test(reason)
    ) {
      findings.push(
        `${label} [警告] 昇級戦を理由に本命候補を除外している疑い(理由文)。本命側の昇級除外は撤廃済み=バグの可能性。要確認`,
      );
    }

    if (r.honmei_horse_number == null && r.aite_horse_number == null) continue; // 見送りは正常

    const { data: entries } = await supabase
      .from("race_entries")
      .select("horse_number, horse_id, expected_popularity, odds_win, horse_rank, horse_rank_comment")
      .eq("race_id", r.id);
    const ent = entries ?? [];
    const popOf = (hn: number | null) =>
      hn == null ? null : ent.find((e) => e.horse_number === hn)?.expected_popularity ?? null;
    const horseIdOf = (hn: number | null) =>
      hn == null ? null : ent.find((e) => e.horse_number === hn)?.horse_id ?? null;

    // 本命は原則1-3番人気
    const honmeiPop = popOf(r.honmei_horse_number);
    if (honmeiPop != null && honmeiPop > 3) {
      findings.push(`${label} [警告] 本命${r.honmei_horse_number}番が${honmeiPop}番人気(4番人気以下)。明確な根拠が必要`);
    }

    // 相手は4-9番人気(非重賞)。1-3番人気の相手は床ガード違反
    for (const [aiteHn, tag] of [
      [r.aite_horse_number, "相手"],
      [r.aite_horse_number_2, "相手2"],
    ] as const) {
      if (aiteHn == null) continue;
      const p = popOf(aiteHn);
      if (!graded && p != null && p <= 3) {
        findings.push(`${label} [違反] ${tag}${aiteHn}番が${p}番人気=人気サイド(妙味帯4-9番人気外)。床ガードをすり抜け`);
      }
    }

    // 少頭数・極端な鉄板(非重賞)に買い目が残っていないか
    if (!graded && r.entry_count != null && r.entry_count <= SMALL_FIELD_MAX) {
      findings.push(`${label} [違反] 少頭数(${r.entry_count}頭≤${SMALL_FIELD_MAX})なのに買い目あり`);
    }
    const oddsList = ent.map((e) => e.odds_win).filter((o): o is number => o != null);
    if (!graded && oddsList.length > 0 && Math.min(...oddsList) < EXTREME_FAVORITE_ODDS) {
      findings.push(`${label} [違反] 極端な鉄板(1番人気${Math.min(...oddsList)}倍<${EXTREME_FAVORITE_ODDS})なのに買い目あり`);
    }

    // データ不足馬(過去走0-1件)を買い目に採用していないか
    for (const [hn, tag] of [
      [r.honmei_horse_number, "本命"],
      [r.aite_horse_number, "相手"],
      [r.aite_horse_number_2, "相手2"],
    ] as const) {
      if (hn == null) continue;
      const hid = horseIdOf(hn);
      if (!hid) continue;
      const { count } = await supabase
        .from("past_performances")
        .select("id", { count: "exact", head: true })
        .eq("horse_id", hid);
      if ((count ?? 0) <= 1) {
        findings.push(`${label} [違反] ${tag}${hn}番の過去走が${count ?? 0}件=データ不足なのに買い目採用`);
      }
    }

    // ★上位人気を"消した"馬を毎回レビュー対象に surface する(2026-08-09、ユーザー要望)。
    // 額面着順で実力馬を誤って危険消しする(UHB賞ナムラクララ)のを防ぐため、上位人気(≤3番人気)なのに
    // 買い目から外した馬を必ず列挙し、「条件補正した実像で 危険(消し) か 妙味(相手) か」を見直す対象にする。
    // 短評に危険/妙味の判定語が無い"黙って消し"は特に注意([要確認・判定なし])。
    const boughtSet = new Set(
      [r.honmei_horse_number, r.aite_horse_number, r.aite_horse_number_2].filter(
        (x): x is number => x != null,
      ),
    );
    for (const e of ent) {
      const pop = e.expected_popularity;
      if (pop == null || pop > 3) continue; // 上位人気(≤3番人気)のみ
      if (boughtSet.has(e.horse_number)) continue; // 買った馬は対象外
      const c = (e.horse_rank_comment ?? "").trim();
      // 昇級初戦除外・データ不足は「額面着順で消した」対象ではなくルール由来の正当な除外なのでノイズとして外す
      if (/昇級|データ不足|評価不能/.test(c)) continue;
      const hasVerdict = /危険|妙味/.test(c);
      const tag = hasVerdict ? "[要確認]" : "[要確認・判定なし]";
      const snippet = c ? c.slice(0, 60) : "(短評なし)";
      findings.push(
        `${label} ${tag} ${e.horse_number}番=${pop}番人気を消し(買い目外)。危険か妙味か条件補正で再確認: 「${snippet}」`,
      );
    }
  }

  console.log(`\n===== 診断QAチェック ${date} (診断済み${races.length}レース) =====`);
  if (findings.length === 0) {
    console.log("✅ 違反・警告なし");
  } else {
    console.log(`⚠️ ${findings.length}件の指摘:`);
    for (const f of findings) console.log("  - " + f);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
