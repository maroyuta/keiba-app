import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// 自動投稿の門番。壊れたデータがそのまま公開投稿になるのを防ぐ。
// 2026-07-11に「odds_winが全馬0のまま診断が走った」事故が実際に起きており、
// 全自動化ではそれが無検査で公開されるリスクがあるため必ずこの層を通す。
// 1つでもerrorが出たら投稿しない(通知のみ)。warningは投稿するが記録に残す。

type Db = SupabaseClient<Database>;

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

// 診断対象(新馬・未勝利・障害を除く=diagnoseUpcoming.tsと同じ条件)のうち、
// 実際に診断できた割合がこれ未満なら、バッチが途中で落ちたとみなす。
// ⚠️固定件数で判定してはいけない: 開催によって対象レース数が大きく変わる
// (2026-07-18は36R中9Rしか対象がなく、固定閾値8だと2件漏れただけで止まっていた)。
const MIN_DIAGNOSED_RATIO = 0.8;
// オッズが入っている馬の割合がこれ未満なら、オッズ取得が壊れている
const MIN_ODDS_COVERAGE = 0.8;

// diagnoseUpcoming.tsの除外条件と揃える(ここがズレると門番が誤判定する)
function isDiagnosisTarget(race: { race_class: string | null; track_type: string }): boolean {
  return (
    !race.race_class?.includes("新馬") &&
    !race.race_class?.includes("未勝利") &&
    race.track_type !== "障害"
  );
}

export async function validatePreview(supabase: Db, date: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { data: races, error } = await supabase
    .from("races")
    .select("id, race_class, track_type, race_rank, honmei_horse_number, aite_horse_number")
    .eq("race_date", date);
  if (error) {
    return { ok: false, errors: [`racesの取得に失敗: ${error.message}`], warnings };
  }

  const all = races ?? [];
  const targets = all.filter(isDiagnosisTarget);
  const diagnosed = targets.filter((r) => r.race_rank !== null);
  if (diagnosed.length === 0) {
    return { ok: false, errors: [`${date}に診断済みレースが1件もない(診断バッチが落ちた?)`], warnings };
  }
  if (targets.length > 0 && diagnosed.length / targets.length < MIN_DIAGNOSED_RATIO) {
    errors.push(
      `診断できたのが対象${targets.length}件中${diagnosed.length}件だけ(全${all.length}件)。診断バッチが途中で落ちた可能性`
    );
  }

  const buys = diagnosed.filter((r) => r.honmei_horse_number !== null);
  if (buys.length === 0) {
    errors.push("買い目のあるレースが0件。全レース見送りの投稿は価値がないため中止");
  }

  // 買いが立ったレースのオッズ充足率を見る(オッズ0のまま診断された事故の検知)
  const buyIds = buys.map((r) => r.id);
  if (buyIds.length > 0) {
    const { data: entries } = await supabase
      .from("race_entries")
      .select("odds_win")
      .in("race_id", buyIds);
    const rows = entries ?? [];
    if (rows.length === 0) {
      errors.push("買い目レースの出走馬が0件(race_entriesが欠損)");
    } else {
      const withOdds = rows.filter((e) => e.odds_win !== null && e.odds_win > 0).length;
      const coverage = withOdds / rows.length;
      if (coverage < MIN_ODDS_COVERAGE) {
        errors.push(
          `オッズ充足率が${(coverage * 100).toFixed(0)}%しかない(${withOdds}/${rows.length}頭)。オッズ未取得のまま診断された可能性`
        );
      }
    }
  }

  // 相手が未設定の買い目は買い目として成立しない
  const noAite = buys.filter((r) => r.aite_horse_number === null).length;
  if (noAite > 0) {
    warnings.push(`相手が未設定の買い目が${noAite}件ある`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

export async function validateResults(supabase: Db, date: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { data, error } = await supabase
    .from("race_recommendation_results")
    .select("stake_yen, return_yen, is_hit, races!inner(race_date)")
    .not("computed_at", "is", null)
    .gte("races.race_date", date)
    .lte("races.race_date", date);
  if (error) {
    return { ok: false, errors: [`結果の取得に失敗: ${error.message}`], warnings };
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return {
      ok: false,
      errors: [`${date}の確定済み結果が0件(配当同期またはROI集計が未完了)`],
      warnings,
    };
  }
  const stake = rows.reduce((sum, r) => sum + (r.stake_yen ?? 0), 0);
  if (stake <= 0) {
    errors.push("投資額の合計が0円。集計が壊れている可能性");
  }
  const unresolved = rows.filter((r) => r.is_hit === null).length;
  if (unresolved > 0) {
    warnings.push(`的中判定が未確定の行が${unresolved}件ある`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
