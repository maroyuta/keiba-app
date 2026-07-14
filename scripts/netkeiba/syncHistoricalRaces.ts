import type { Database } from "@/lib/supabase/database.types";
import { fetchNetkeibaHtml } from "./httpClient";
import { parseRaceResultHtml, type ParsedRaceResult } from "./parseRaceResult";
import { createNetkeibaSyncClient } from "./supabaseClient";

// JV-Link(Windows)がまだ同期していない過去日について、netkeibaの結果ページ(result.html)から
// races/horses/race_entriesを丸ごと新規作成する「レースの箱自体を増やす」機構。バックテスト対象を
// JV-Link同期済みの日付(07-04/05/11)より前にも広げたい、という要望で2026-07-13に新設した。
//
// 既存のsyncPastPerformances(既存horseの追加走歴を埋めるだけ)・syncPayouts(既存raceに配当・
// 確定オッズ/着順・race_classを追記するだけ)はどちらも「raceが既に存在する」前提だったため、
// race自体が無い過去日はバックテスト対象にできなかった。このスクリプトはrace_entriesの
// 基本情報(枠番・馬番・騎手・斤量・馬体重)だけを作り、確定オッズ/着順/配当/race_classの反映は
// 責務を分けて既存のsyncPayoutsに任せる設計(runHistoricalRaces.tsで連続実行する)。
//
// JV-Dataが正・netkeibaは補助という既存方針を守るため、syncShutuba.tsと同じく
// 「既存行があれば一切上書きしない」insert-onlyで書く。

export interface HistoricalRaceSyncSummary {
  raceId: string;
  status: "ok" | "fetch_failed" | "parse_failed" | "write_failed" | "skipped_excluded_class";
  raceCreated: boolean;
  horsesUpserted: number;
  entriesInserted: number;
}

function buildResultUrl(raceId: string): string {
  return `https://race.netkeiba.com/race/result.html?race_id=${raceId}`;
}

// 新馬・未勝利は既存の診断ロジック(src/app/api/races/[raceId]/diagnose/route.ts)が
// 最初から対象外にしている(基本的に馬券を買わないクラスのため)。バックテスト用に
// レースの箱を増やす目的なら、この2クラスを取得してもDBを肥やすだけで使い道が無いため
// 収集自体をスキップする。既存の除外ロジックと同じ`race_class.includes(...)`判定に揃えている。
function isExcludedRaceClass(raceClass: string | null): boolean {
  return raceClass !== null && (raceClass.includes("新馬") || raceClass.includes("未勝利"));
}

async function ensureRace(
  supabase: ReturnType<typeof createNetkeibaSyncClient>,
  raceId: string,
  meta: ParsedRaceResult["meta"],
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: selectError } = await supabase
    .from("races")
    .select("id")
    .eq("jv_race_key", raceId)
    .maybeSingle();
  if (selectError) {
    throw new Error(`races検索に失敗: ${selectError.message}`);
  }
  if (existing) {
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
    kaiji: Number(raceId.slice(6, 8)) || null,
    nichiji: Number(raceId.slice(8, 10)) || null,
    race_number: meta.raceNumber,
    race_name: meta.raceName,
    grade: meta.grade,
    race_class: meta.raceClass,
    track_type: meta.trackType,
    distance_m: meta.distanceM,
    track_condition: meta.trackCondition,
    weather: meta.weather,
    entry_count: meta.entryCount,
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
  horses: ParsedRaceResult["horses"],
): Promise<Map<string, string>> {
  const rows: Database["public"]["Tables"]["horses"]["Insert"][] = horses.map((h) => ({
    jv_horse_id: h.netkeibaHorseId,
    horse_name: h.horseName,
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
  horses: ParsedRaceResult["horses"],
  horseInternalIdByJvId: Map<string, string>,
): Promise<number> {
  const withNumbers = horses.filter(
    (h): h is typeof h & { postPosition: number; horseNumber: number } =>
      h.postPosition !== null && h.horseNumber !== null,
  );
  if (withNumbers.length === 0) return 0;

  const { data: existing, error: existingError } = await supabase
    .from("race_entries")
    .select("horse_number")
    .eq("race_id", raceInternalId);
  if (existingError) {
    throw new Error(`race_entries検索に失敗: ${existingError.message}`);
  }
  const existingNumbers = new Set((existing ?? []).map((e) => e.horse_number));

  let inserted = 0;
  for (const horse of withNumbers) {
    if (existingNumbers.has(horse.horseNumber)) continue; // JV-Link等で既にある行は上書きしない

    const internalHorseId = horseInternalIdByJvId.get(horse.netkeibaHorseId);
    if (!internalHorseId) continue;

    const row: Database["public"]["Tables"]["race_entries"]["Insert"] = {
      race_id: raceInternalId,
      horse_id: internalHorseId,
      horse_number: horse.horseNumber,
      post_position: horse.postPosition,
      jockey_name: horse.jockeyName,
      jockey_weight_kg: horse.jockeyWeightKg,
      horse_weight_kg: horse.horseWeightKg,
      horse_weight_diff_kg: horse.horseWeightDiffKg,
    };
    const { error: insertError } = await supabase.from("race_entries").insert(row);
    if (insertError) {
      console.warn(
        `[netkeiba] race_entries作成失敗 race_id=${raceId} horse_number=${horse.horseNumber}:`,
        insertError.message,
      );
      continue;
    }
    inserted += 1;
  }

  return inserted;
}

export async function syncHistoricalRaces(raceIds: string[]): Promise<HistoricalRaceSyncSummary[]> {
  const supabase = createNetkeibaSyncClient();
  const summaries: HistoricalRaceSyncSummary[] = [];

  for (const raceId of raceIds) {
    const url = buildResultUrl(raceId);
    console.log(`[netkeiba] fetching ${url}`);
    const html = await fetchNetkeibaHtml(url);
    if (!html) {
      summaries.push({
        raceId,
        status: "fetch_failed",
        raceCreated: false,
        horsesUpserted: 0,
        entriesInserted: 0,
      });
      continue;
    }

    let parsed: ParsedRaceResult | null;
    try {
      parsed = parseRaceResultHtml(html, raceId);
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
      });
      continue;
    }

    try {
      const { id: raceInternalId, created } = await ensureRace(supabase, raceId, parsed.meta);
      const horseIdByJvId = await ensureHorses(supabase, parsed.horses);
      const entriesInserted = await insertMissingEntries(
        supabase,
        raceInternalId,
        raceId,
        parsed.horses,
        horseIdByJvId,
      );
      summaries.push({
        raceId,
        status: "ok",
        raceCreated: created,
        horsesUpserted: horseIdByJvId.size,
        entriesInserted,
      });
    } catch (err) {
      console.warn(`[netkeiba] DB書き込み失敗 race_id=${raceId}:`, err);
      summaries.push({
        raceId,
        status: "write_failed",
        raceCreated: false,
        horsesUpserted: 0,
        entriesInserted: 0,
      });
    }
  }

  return summaries;
}
