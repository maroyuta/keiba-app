import { createAdminClient } from "@/lib/supabase/admin";

// 開発用の一回限りのシードスクリプト。
// 2026-01-31 小倉1R (netkeiba race_id=202610010301) の実データを使い、
// /api/races/[raceId]/diagnose を実際に叩いてテストするためのfixtureを投入する。
// 診断対象としては「これから出走するレース」を想定しているAPIだが、
// 疎通確認が目的のため既に確定済みの実レースデータをそのまま使う。

const HORSES = [
  { jv_horse_id: "2023103929", horse_name: "ウーマンズパワー", sex: "牝" },
  { jv_horse_id: "2023101676", horse_name: "ファンシーフリル", sex: "牝" },
  { jv_horse_id: "2023101061", horse_name: "カレンココナ", sex: "牝" },
  { jv_horse_id: "2023102606", horse_name: "ミヤフロント", sex: "牝" },
  { jv_horse_id: "2023104607", horse_name: "チュラヴェール", sex: "牝" },
  { jv_horse_id: "2023101660", horse_name: "スイーヴル", sex: "牝" },
  { jv_horse_id: "2023109039", horse_name: "カイトヴァイター", sex: "牡" },
  { jv_horse_id: "2023100982", horse_name: "シビルガード", sex: "牡" },
  { jv_horse_id: "2023101810", horse_name: "ヴォンドゥ", sex: "牝" },
  { jv_horse_id: "2023101712", horse_name: "ベアゴーフォー", sex: "牡" },
  { jv_horse_id: "2023106556", horse_name: "サンライズロイ", sex: "牡" },
  { jv_horse_id: "2023101410", horse_name: "ソヴァージュ", sex: "牝" },
  { jv_horse_id: "2023100688", horse_name: "マスキュラー", sex: "牡" },
  { jv_horse_id: "2023103525", horse_name: "アヴァンフライト", sex: "牝" },
] as const;

const RACE = {
  jv_race_key: "netkeiba-202610010301",
  keibajo_code: "10",
  keibajo_name: "小倉",
  kaiji: 1,
  nichiji: 3,
  race_number: 1,
  race_date: "2026-01-31",
  post_time: "09:45",
  race_name: "3歳未勝利",
  race_class: "サラ系３歳 未勝利 馬齢",
  track_type: "ダート",
  distance_m: 1000,
  turn_direction: "右",
  weather: "晴",
  track_condition: "良",
  entry_count: 14,
} as const;

const ENTRIES = [
  { jv_horse_id: "2023103929", post_position: 5, horse_number: 7, jockey_name: "横山琉", jockey_weight_kg: 55, horse_weight_kg: 454, horse_weight_diff_kg: -12, odds_win: 1.7, expected_popularity: 1 },
  { jv_horse_id: "2023101676", post_position: 4, horse_number: 5, jockey_name: "秋山稔", jockey_weight_kg: 55, horse_weight_kg: 458, horse_weight_diff_kg: 0, odds_win: 4.9, expected_popularity: 2 },
  { jv_horse_id: "2023101061", post_position: 1, horse_number: 1, jockey_name: "小崎", jockey_weight_kg: 55, horse_weight_kg: 440, horse_weight_diff_kg: 4, odds_win: 18.1, expected_popularity: 5 },
  { jv_horse_id: "2023102606", post_position: 2, horse_number: 2, jockey_name: "森田", jockey_weight_kg: 52, horse_weight_kg: 458, horse_weight_diff_kg: 14, odds_win: 47.1, expected_popularity: 10 },
  { jv_horse_id: "2023104607", post_position: 8, horse_number: 14, jockey_name: "丹内", jockey_weight_kg: 55, horse_weight_kg: 446, horse_weight_diff_kg: 0, odds_win: 18.0, expected_popularity: 4 },
  { jv_horse_id: "2023101660", post_position: 6, horse_number: 9, jockey_name: "長岡", jockey_weight_kg: 55, horse_weight_kg: 452, horse_weight_diff_kg: -4, odds_win: 154.9, expected_popularity: 13 },
  { jv_horse_id: "2023109039", post_position: 3, horse_number: 4, jockey_name: "黛", jockey_weight_kg: 57, horse_weight_kg: 452, horse_weight_diff_kg: 16, odds_win: 102.2, expected_popularity: 12 },
  { jv_horse_id: "2023100982", post_position: 7, horse_number: 12, jockey_name: "藤懸", jockey_weight_kg: 57, horse_weight_kg: 458, horse_weight_diff_kg: -8, odds_win: 48.8, expected_popularity: 11 },
  { jv_horse_id: "2023101810", post_position: 6, horse_number: 10, jockey_name: "舟山", jockey_weight_kg: 52, horse_weight_kg: 416, horse_weight_diff_kg: -8, odds_win: 5.4, expected_popularity: 3 },
  { jv_horse_id: "2023101712", post_position: 8, horse_number: 13, jockey_name: "水沼", jockey_weight_kg: 54, horse_weight_kg: 462, horse_weight_diff_kg: -6, odds_win: 34.7, expected_popularity: 8 },
  { jv_horse_id: "2023106556", post_position: 7, horse_number: 11, jockey_name: "河原田", jockey_weight_kg: 53, horse_weight_kg: 476, horse_weight_diff_kg: 12, odds_win: 36.3, expected_popularity: 9 },
  { jv_horse_id: "2023101410", post_position: 3, horse_number: 3, jockey_name: "野中", jockey_weight_kg: 55, horse_weight_kg: 438, horse_weight_diff_kg: 8, odds_win: 261.7, expected_popularity: 14 },
  { jv_horse_id: "2023100688", post_position: 4, horse_number: 6, jockey_name: "和田陽", jockey_weight_kg: 54, horse_weight_kg: 476, horse_weight_diff_kg: 0, odds_win: 21.9, expected_popularity: 6 },
  { jv_horse_id: "2023103525", post_position: 5, horse_number: 8, jockey_name: "小林美", jockey_weight_kg: 52, horse_weight_kg: 442, horse_weight_diff_kg: -2, odds_win: 33.8, expected_popularity: 7 },
] as const;

async function main() {
  const supabase = createAdminClient();

  const { data: horses, error: horsesError } = await supabase
    .from("horses")
    .upsert([...HORSES], { onConflict: "jv_horse_id" })
    .select("id, jv_horse_id");
  if (horsesError) throw new Error(`horses upsert失敗: ${horsesError.message}`);

  const { data: race, error: raceError } = await supabase
    .from("races")
    .upsert(RACE, { onConflict: "jv_race_key" })
    .select("id")
    .single();
  if (raceError || !race) throw new Error(`races upsert失敗: ${raceError?.message}`);

  const horseIdByJvId = new Map(horses.map((h) => [h.jv_horse_id, h.id]));

  const entryRows = ENTRIES.map((entry) => {
    const horseId = horseIdByJvId.get(entry.jv_horse_id);
    if (!horseId) throw new Error(`horse not found for jv_horse_id=${entry.jv_horse_id}`);
    return {
      race_id: race.id,
      horse_id: horseId,
      post_position: entry.post_position,
      horse_number: entry.horse_number,
      jockey_name: entry.jockey_name,
      jockey_weight_kg: entry.jockey_weight_kg,
      horse_weight_kg: entry.horse_weight_kg,
      horse_weight_diff_kg: entry.horse_weight_diff_kg,
      odds_win: entry.odds_win,
      expected_popularity: entry.expected_popularity,
    };
  });

  const { error: entriesError } = await supabase
    .from("race_entries")
    .upsert(entryRows, { onConflict: "race_id,horse_number" });
  if (entriesError) throw new Error(`race_entries upsert失敗: ${entriesError.message}`);

  console.log("race_id:", race.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
