import { createAdminClient } from "@/lib/supabase/admin";

// scripts/seed-test-race.ts で投入した2026-01-31小倉1Rの上位人気馬向けに、
// standard/premium診断エスカレーション経路とrace_entries書き戻しを検証するための
// 【架空の】直近戦績データを投入する。実データではない開発用テストフィクスチャ。

const PAST_PERFORMANCES: Array<{
  jv_horse_id: string;
  race_date: string;
  keibajo_code: string;
  keibajo_name: string;
  race_number: number;
  race_name: string;
  race_class: string;
  track_type: "芝" | "ダート";
  distance_m: number;
  track_condition: "良" | "稍重" | "重" | "不良";
  entry_count: number;
  post_position: number;
  horse_number: number;
  jockey_name: string;
  horse_weight_kg: number;
  horse_weight_diff_kg: number;
  odds_win: number;
  popularity: number;
  finish_position: number;
  finish_time_sec: number;
  margin_sec: number;
  corner_positions: string;
  pace_mark: "S" | "M" | "H";
  agari_3f_sec: number;
}> = [
  // ウーマンズパワー (1番人気): 前走僅差2着、前々走3着で上積み十分
  { jv_horse_id: "2023103929", race_date: "2025-12-20", keibajo_code: "09", keibajo_name: "阪神", race_number: 5, race_name: "2歳新馬", race_class: "サラ系２歳 新馬", track_type: "ダート", distance_m: 1200, track_condition: "良", entry_count: 12, post_position: 4, horse_number: 6, jockey_name: "横山琉", horse_weight_kg: 466, horse_weight_diff_kg: 0, odds_win: 3.2, popularity: 2, finish_position: 2, finish_time_sec: 71.2, margin_sec: 0.2, corner_positions: "3-2", pace_mark: "M", agari_3f_sec: 37.1 },
  { jv_horse_id: "2023103929", race_date: "2025-11-15", keibajo_code: "09", keibajo_name: "阪神", race_number: 3, race_name: "2歳新馬", race_class: "サラ系２歳 新馬", track_type: "ダート", distance_m: 1200, track_condition: "稍重", entry_count: 14, post_position: 7, horse_number: 9, jockey_name: "横山琉", horse_weight_kg: 466, horse_weight_diff_kg: -4, odds_win: 8.5, popularity: 4, finish_position: 3, finish_time_sec: 71.8, margin_sec: 0.5, corner_positions: "5-4", pace_mark: "H", agari_3f_sec: 37.5 },

  // ファンシーフリル (2番人気): 前走2着、地力上位
  { jv_horse_id: "2023101676", race_date: "2025-12-27", keibajo_code: "10", keibajo_name: "小倉", race_number: 6, race_name: "2歳新馬", race_class: "サラ系２歳 新馬", track_type: "ダート", distance_m: 1000, track_condition: "良", entry_count: 13, post_position: 3, horse_number: 4, jockey_name: "秋山稔", horse_weight_kg: 458, horse_weight_diff_kg: 0, odds_win: 4.1, popularity: 2, finish_position: 2, finish_time_sec: 58.7, margin_sec: 0.1, corner_positions: "2-2", pace_mark: "H", agari_3f_sec: 36.0 },

  // ヴォンドゥ (3番人気): 前走1着僅差負け(2着)、コース実績あり
  { jv_horse_id: "2023101810", race_date: "2025-12-20", keibajo_code: "10", keibajo_name: "小倉", race_number: 4, race_name: "2歳新馬", race_class: "サラ系２歳 新馬", track_type: "ダート", distance_m: 1000, track_condition: "良", entry_count: 14, post_position: 6, horse_number: 10, jockey_name: "舟山", horse_weight_kg: 424, horse_weight_diff_kg: 0, odds_win: 2.8, popularity: 1, finish_position: 2, finish_time_sec: 58.5, margin_sec: 0.1, corner_positions: "1-1", pace_mark: "H", agari_3f_sec: 35.8 },

  // チュラヴェール (4番人気)
  { jv_horse_id: "2023104607", race_date: "2025-12-13", keibajo_code: "06", keibajo_name: "中山", race_number: 7, race_name: "2歳新馬", race_class: "サラ系２歳 新馬", track_type: "ダート", distance_m: 1200, track_condition: "稍重", entry_count: 15, post_position: 8, horse_number: 12, jockey_name: "丹内", horse_weight_kg: 446, horse_weight_diff_kg: 0, odds_win: 12.3, popularity: 5, finish_position: 4, finish_time_sec: 73.0, margin_sec: 0.6, corner_positions: "6-5", pace_mark: "M", agari_3f_sec: 38.0 },

  // カレンココナ (5番人気): 中央場所実績
  { jv_horse_id: "2023101061", race_date: "2025-11-29", keibajo_code: "09", keibajo_name: "阪神", race_number: 2, race_name: "2歳新馬", race_class: "サラ系２歳 新馬", track_type: "ダート", distance_m: 1400, track_condition: "良", entry_count: 12, post_position: 1, horse_number: 1, jockey_name: "小崎", horse_weight_kg: 436, horse_weight_diff_kg: 0, odds_win: 22.0, popularity: 7, finish_position: 5, finish_time_sec: 85.3, margin_sec: 1.0, corner_positions: "9-8", pace_mark: "S", agari_3f_sec: 38.4 },

  // マスキュラー (6番人気)
  { jv_horse_id: "2023100688", race_date: "2025-12-06", keibajo_code: "07", keibajo_name: "中京", race_number: 8, race_name: "2歳新馬", race_class: "サラ系２歳 新馬", track_type: "ダート", distance_m: 1200, track_condition: "重", entry_count: 16, post_position: 10, horse_number: 14, jockey_name: "和田陽", horse_weight_kg: 476, horse_weight_diff_kg: 0, odds_win: 15.6, popularity: 6, finish_position: 6, finish_time_sec: 74.1, margin_sec: 1.2, corner_positions: "11-10", pace_mark: "H", agari_3f_sec: 38.8 },
];

async function main() {
  const supabase = createAdminClient();

  const jvHorseIds = [...new Set(PAST_PERFORMANCES.map((p) => p.jv_horse_id))];
  const { data: horses, error: horsesError } = await supabase
    .from("horses")
    .select("id, jv_horse_id")
    .in("jv_horse_id", jvHorseIds);
  if (horsesError || !horses) throw new Error(`horses取得失敗: ${horsesError?.message}`);

  const horseIdByJvId = new Map(horses.map((h) => [h.jv_horse_id, h.id]));

  const rows = PAST_PERFORMANCES.map(({ jv_horse_id, ...pp }) => {
    const horseId = horseIdByJvId.get(jv_horse_id);
    if (!horseId) throw new Error(`horse not found for jv_horse_id=${jv_horse_id}`);
    return {
      horse_id: horseId,
      data_source: "netkeiba" as const,
      source_url: "https://example.com/test-fixture-not-real",
      ...pp,
    };
  });

  const { error } = await supabase
    .from("past_performances")
    .upsert(rows, { onConflict: "horse_id,race_date,keibajo_code,race_number" });
  if (error) throw new Error(`past_performances upsert失敗: ${error.message}`);

  console.log(`${rows.length}件のテスト用過去成績を投入しました`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
