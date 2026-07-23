import type { Database } from "@/lib/supabase/database.types";
import { fetchNetkeibaHtml } from "./httpClient";
import { parseShutubaHtml, type ParsedShutuba } from "./parseShutuba";
import { createNetkeibaSyncClient } from "./supabaseClient";

// JV-Link(Windows、週次)がまだ同期していない未来のレースについて、netkeibaの出馬表(shutuba.html)
// からraces/horses/race_entriesを先回りで作成する。「JRAの正式データはJV-Link優先、netkeibaは
// 補助情報のみ」という既存方針(AGENTS.md)に従い、**既にraces/race_entries行が存在する場合は
// 一切上書きしない**(存在確認→無ければ作成、のinsert-onlyで書く。upsertによる上書きはしない)。
// horsesだけは他の同期スクリプトと同様にupsert(既存行のname/sex/trainer等を補強するだけで
// 実害が無いため)。
//
// 枠番(post_position)・馬番(horse_number)は枠順確定(JRA公式スケジュール実測: 木曜16時頃に馬番なし出馬表、金曜10時頃に土曜分の枠番確定、土曜10時頃に日曜分の枠番確定、2026-07-23確認)が
// 終わるまでnetkeiba側にも載らない。確定前に呼んだ場合はraces/horsesだけ作成し、race_entriesは
// 「確定待ち」としてスキップする。確定後に同じrace_idで再実行すればrace_entriesが作成される
// (race_id・races行が既にあっても壊さない設計なので、様子見しながら何度でも再実行してよい)。

export interface ShutubaSyncSummary {
  raceId: string;
  status: "ok" | "fetch_failed" | "parse_failed" | "write_failed" | "skipped_excluded_class";
  raceCreated: boolean;
  horsesUpserted: number;
  entriesInserted: number;
  entriesSkippedNotDrawn: number;
  oddsUpdated: number;
}

// 新馬・未勝利は既存の診断ロジック(src/app/api/races/[raceId]/diagnose/route.ts)が
// 最初から対象外にしている(基本的に馬券を買わないクラスのため)。先回りでraces行を
// 作っても使い道が無いため収集自体をスキップする。
function isExcludedRaceClass(raceClass: string | null): boolean {
  return raceClass !== null && (raceClass.includes("新馬") || raceClass.includes("未勝利"));
}

function buildShutubaUrl(raceId: string): string {
  return `https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
}

async function ensureRace(
  supabase: ReturnType<typeof createNetkeibaSyncClient>,
  raceId: string,
  meta: ParsedShutuba["meta"],
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: selectError } = await supabase
    .from("races")
    .select("id, entry_count")
    .eq("jv_race_key", raceId)
    .maybeSingle();
  if (selectError) {
    throw new Error(`races検索に失敗: ${selectError.message}`);
  }
  if (existing) {
    // entry_countは出走取消・除外で開催が近づくほど減っていくため、race行自体は
    // insert-onlyでもentry_countだけは最新のnetkeiba値へ都度更新する(古い登録頭数の
    // まま取り残されると「実際より多い頭数」がUIに残り続けるバグになるため)。
    if (meta.entryCount !== null && meta.entryCount !== existing.entry_count) {
      const { error: updateError } = await supabase
        .from("races")
        .update({ entry_count: meta.entryCount })
        .eq("id", existing.id);
      if (updateError) {
        throw new Error(`races.entry_count更新に失敗: ${updateError.message}`);
      }
    }
    return { id: existing.id, created: false };
  }
  if (!meta.raceDate || !meta.trackType || !meta.distanceM || !meta.raceNumber) {
    throw new Error("races新規作成に必要な情報(開催日/馬場/距離/レース番号)が不足しています");
  }

  const row: Database["public"]["Tables"]["races"]["Insert"] = {
    jv_race_key: raceId,
    race_date: meta.raceDate,
    keibajo_code: meta.keibajoCode,
    keibajo_name: meta.keibajoName,
    kaiji: meta.kaiji,
    nichiji: meta.nichiji,
    race_number: meta.raceNumber,
    race_name: meta.raceName,
    grade: meta.grade,
    race_class: meta.raceClass,
    track_type: meta.trackType,
    distance_m: meta.distanceM,
    entry_count: meta.entryCount,
    post_time: meta.postTime,
  };
  const { data: inserted, error: insertError } = await supabase
    .from("races")
    .insert(row)
    .select("id")
    .single();
  if (insertError) {
    throw new Error(`races作成に失敗: ${insertError.message}`);
  }
  return { id: inserted.id, created: true };
}

async function ensureHorses(
  supabase: ReturnType<typeof createNetkeibaSyncClient>,
  horses: ParsedShutuba["horses"],
): Promise<Map<string, string>> {
  const rows: Database["public"]["Tables"]["horses"]["Insert"][] = horses.map((h) => ({
    jv_horse_id: h.netkeibaHorseId,
    horse_name: h.horseName,
    sex: h.sex,
    trainer_name: h.trainerName,
    trainer_affiliation: h.trainerAffiliation,
  }));
  const { data, error } = await supabase
    .from("horses")
    .upsert(rows, { onConflict: "jv_horse_id" })
    .select("id, jv_horse_id");
  if (error) {
    throw new Error(`horses upsertに失敗: ${error.message}`);
  }
  return new Map(data.map((h) => [h.jv_horse_id, h.id]));
}

async function insertMissingEntries(
  supabase: ReturnType<typeof createNetkeibaSyncClient>,
  raceInternalId: string,
  raceId: string,
  horses: ParsedShutuba["horses"],
  horseInternalIdByJvId: Map<string, string>,
): Promise<{ inserted: number; skippedNotDrawn: number }> {
  const drawn = horses.filter(
    (h): h is typeof h & { postPosition: number; horseNumber: number } =>
      h.postPosition !== null && h.horseNumber !== null,
  );
  const skippedNotDrawn = horses.length - drawn.length;
  if (drawn.length === 0) {
    return { inserted: 0, skippedNotDrawn };
  }

  const { data: existing, error: existingError } = await supabase
    .from("race_entries")
    .select("horse_number")
    .eq("race_id", raceInternalId);
  if (existingError) {
    throw new Error(`race_entries検索に失敗: ${existingError.message}`);
  }
  const existingNumbers = new Set((existing ?? []).map((e) => e.horse_number));

  let inserted = 0;
  for (const horse of drawn) {
    if (existingNumbers.has(horse.horseNumber)) continue; // JV-Link等で既にある行は上書きしない

    const internalHorseId = horseInternalIdByJvId.get(horse.netkeibaHorseId);
    if (!internalHorseId) continue; // ensureHorsesで作成/取得できなかった馬 (通常起きないはず)

    const row: Database["public"]["Tables"]["race_entries"]["Insert"] = {
      race_id: raceInternalId,
      horse_id: internalHorseId,
      horse_number: horse.horseNumber,
      post_position: horse.postPosition,
      jockey_name: horse.jockeyName,
      jockey_weight_kg: horse.jockeyWeightKg,
      trainer_name: horse.trainerName,
      horse_weight_kg: horse.horseWeightKg,
      horse_weight_diff_kg: horse.horseWeightDiffKg,
    };
    const { error: insertError } = await supabase.from("race_entries").insert(row);
    if (insertError) {
      // JV-Linkが同時に書き込んだ等の競合は許容し、次の馬へ進む(上書きはしない)
      console.warn(
        `[netkeiba] race_entries作成失敗 race_id=${raceId} horse_number=${horse.horseNumber}:`,
        insertError.message,
      );
      continue;
    }
    inserted += 1;
  }

  return { inserted, skippedNotDrawn };
}

// race_entries.odds_win/expected_popularityを更新する。insertMissingEntriesと違い、
// 既に存在する行も対象(オッズは発売開始後レース直前まで変動し続けるため、何度でも
// 上書きして最新化したい)。プレースホルダー("---.-"等)由来のnullは書き込まない
// (parseShutubaHtml側で既にnull化済み。取得できた時だけ更新し、既存値を消さない)。
async function updateOdds(
  supabase: ReturnType<typeof createNetkeibaSyncClient>,
  raceInternalId: string,
  horses: ParsedShutuba["horses"],
): Promise<number> {
  const withOdds = horses.filter(
    (h): h is typeof h & { horseNumber: number; oddsWin: number } =>
      h.horseNumber !== null && h.oddsWin !== null,
  );
  if (withOdds.length === 0) return 0;

  let updated = 0;
  for (const horse of withOdds) {
    const { error } = await supabase
      .from("race_entries")
      .update({ odds_win: horse.oddsWin, expected_popularity: horse.popularity })
      .eq("race_id", raceInternalId)
      .eq("horse_number", horse.horseNumber);
    if (error) {
      console.warn(
        `[netkeiba] オッズ更新失敗 race_id=${raceInternalId} horse_number=${horse.horseNumber}:`,
        error.message,
      );
      continue;
    }
    updated += 1;
  }
  return updated;
}

export async function syncShutuba(raceIds: string[]): Promise<ShutubaSyncSummary[]> {
  const supabase = createNetkeibaSyncClient();
  const summaries: ShutubaSyncSummary[] = [];

  for (const raceId of raceIds) {
    const url = buildShutubaUrl(raceId);
    console.log(`[netkeiba] fetching ${url}`);
    const html = await fetchNetkeibaHtml(url);
    if (!html) {
      summaries.push({
        raceId,
        status: "fetch_failed",
        raceCreated: false,
        horsesUpserted: 0,
        entriesInserted: 0,
        entriesSkippedNotDrawn: 0,
        oddsUpdated: 0,
      });
      continue;
    }

    let parsed: ParsedShutuba | null;
    try {
      parsed = parseShutubaHtml(html, raceId);
    } catch (err) {
      console.warn(`[netkeiba] parse失敗 race_id=${raceId}:`, err);
      parsed = null;
    }
    if (!parsed || parsed.horses.length === 0) {
      summaries.push({
        raceId,
        status: "parse_failed",
        raceCreated: false,
        horsesUpserted: 0,
        entriesInserted: 0,
        entriesSkippedNotDrawn: 0,
        oddsUpdated: 0,
      });
      continue;
    }
    if (isExcludedRaceClass(parsed.meta.raceClass)) {
      summaries.push({
        raceId,
        status: "skipped_excluded_class",
        raceCreated: false,
        horsesUpserted: 0,
        entriesInserted: 0,
        entriesSkippedNotDrawn: 0,
        oddsUpdated: 0,
      });
      continue;
    }

    try {
      const { id: raceInternalId, created } = await ensureRace(supabase, raceId, parsed.meta);
      const horseIdByJvId = await ensureHorses(supabase, parsed.horses);
      const { inserted, skippedNotDrawn } = await insertMissingEntries(
        supabase,
        raceInternalId,
        raceId,
        parsed.horses,
        horseIdByJvId,
      );
      const oddsUpdated = await updateOdds(supabase, raceInternalId, parsed.horses);
      summaries.push({
        raceId,
        status: "ok",
        raceCreated: created,
        horsesUpserted: horseIdByJvId.size,
        entriesInserted: inserted,
        entriesSkippedNotDrawn: skippedNotDrawn,
        oddsUpdated,
      });
    } catch (err) {
      console.warn(`[netkeiba] DB書き込み失敗 race_id=${raceId}:`, err);
      summaries.push({
        raceId,
        status: "write_failed",
        raceCreated: false,
        horsesUpserted: 0,
        entriesInserted: 0,
        entriesSkippedNotDrawn: 0,
        oddsUpdated: 0,
      });
    }
  }

  return summaries;
}
