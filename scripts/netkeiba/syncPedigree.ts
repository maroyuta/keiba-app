import { fetchNetkeibaHtml } from "./httpClient";
import { buildPedigreeAjaxUrl, parsePedigreeJson } from "./parsePedigree";
import { createNetkeibaSyncClient } from "./supabaseClient";

export interface PedigreeSyncSummary {
  jvHorseId: string;
  status: "ok" | "no_data" | "fetch_failed";
}

// horses.sire_name/dam_name/dam_sire_name(既存カラム、簡易1〜2世代参照)へのバックフィル。
// 3代血統フル(horse_pedigrees、BLOD準拠)はJV-Link投入待ちのまま別管理とし、
// こちらはnetkeiba経由で無料・即座に取れる範囲に限定したスコープ。
// 既に値が入っている馬は上書きしない(JV-Link由来の値を将来壊さないため)。
export async function syncPedigree(jvHorseIds: string[]): Promise<PedigreeSyncSummary[]> {
  const supabase = createNetkeibaSyncClient();
  const summaries: PedigreeSyncSummary[] = [];

  for (const jvHorseId of jvHorseIds) {
    const url = buildPedigreeAjaxUrl(jvHorseId);
    const json = await fetchNetkeibaHtml(url, "utf-8");
    if (!json) {
      summaries.push({ jvHorseId, status: "fetch_failed" });
      continue;
    }

    const pedigree = parsePedigreeJson(json);
    if (!pedigree) {
      summaries.push({ jvHorseId, status: "no_data" });
      continue;
    }

    const { error } = await supabase
      .from("horses")
      .update({
        sire_name: pedigree.sireName,
        dam_name: pedigree.damName,
        dam_sire_name: pedigree.damSireName,
      })
      .eq("jv_horse_id", jvHorseId)
      .is("sire_name", null);

    if (error) {
      throw new Error(`horses更新に失敗(${jvHorseId}): ${error.message}`);
    }

    summaries.push({ jvHorseId, status: "ok" });
  }

  return summaries;
}
