// horses.sire_name が null の馬(2代血統未取得)を全件、netkeiba経由でbackfillする。
// syncPedigreeは sire_name is null の馬だけ埋めるため、中断しても再実行で残りだけ続く(再開可)。
// 使い方: npx tsx scripts/netkeiba/backfillMissingPedigree.ts --env-file .env.local
import { loadEnvFileFromArgs } from "./loadEnvFile";
import { createNetkeibaSyncClient } from "./supabaseClient";
import { syncPedigree } from "./syncPedigree";

async function main() {
  loadEnvFileFromArgs(process.argv.slice(2));
  const supabase = createNetkeibaSyncClient();

  const all: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("horses")
      .select("jv_horse_id")
      .is("sire_name", null)
      .not("jv_horse_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const h of data) if (h.jv_horse_id) all.push(h.jv_horse_id);
    if (data.length < PAGE) break;
  }
  console.log(`[pedigree-backfill] 対象 ${all.length}頭 (5秒間隔なので約${Math.round((all.length * 5) / 3600)}時間)`);

  const CHUNK = 50;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    try {
      await syncPedigree(chunk);
    } catch (e) {
      console.warn(`[pedigree-backfill] chunk失敗(継続):`, e);
    }
    console.log(`[pedigree-backfill] ${Math.min(i + CHUNK, all.length)}/${all.length} 完了`);
  }
  console.log("[pedigree-backfill] 全完了");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
