import { syncOddsForRaces } from "./syncOdds";
import { loadEnvFileFromArgs } from "./loadEnvFile";
import { createNetkeibaSyncClient } from "./supabaseClient";

// 指定日のracesからjv_race_key(=netkeiba race_id)を引いてオッズを一括同期する。
//
// 使い方:
//   npm run sync:netkeiba:odds -- --date 2026-08-22 --env-file .env.local
//   npm run sync:netkeiba:odds -- --race 202604020711 --env-file .env.local
//
// なぜ必要か: odds_win/expected_popularity/race_odds_combinationsを書けるのが
// JV-Link(Windows専用)だけだったため、Windowsが動いていない週末はオッズが入らず、
// 人気ガードが働いて買い目が0件になる(または2026-08-15/16のようにodds_win=0で埋まる)。
// JRAは必ずオッズを出しているので、取得経路が1本しか無いことが問題だった。これはその冗長化。
//
// 発売前のレースはオッズがまだ立っていないため"no_odds"としてスキップされる(エラーではない)。
// 発走が近づくほどオッズは変動するので、実際に買う直前にもう一度走らせるのが望ましい。
async function main() {
  const args = loadEnvFileFromArgs(process.argv.slice(2));
  const dateIdx = args.indexOf("--date");
  const date = dateIdx !== -1 ? args[dateIdx + 1] : null;
  const raceIdx = args.indexOf("--race");
  const singleRaceId = raceIdx !== -1 ? args[raceIdx + 1] : null;

  if (!date && !singleRaceId) {
    console.error(
      "使い方: npm run sync:netkeiba:odds -- --date YYYY-MM-DD [--env-file <path>]\n" +
        "        npm run sync:netkeiba:odds -- --race <netkeiba_race_id> [--env-file <path>]",
    );
    process.exit(1);
  }

  let raceIds: string[];
  if (singleRaceId) {
    raceIds = [singleRaceId];
  } else {
    const supabase = createNetkeibaSyncClient();
    const { data: races, error } = await supabase
      .from("races")
      .select("jv_race_key, keibajo_name, race_number")
      .eq("race_date", date!)
      .neq("track_type", "障害")
      .order("keibajo_name")
      .order("race_number");
    if (error) throw new Error(`racesの取得に失敗しました: ${error.message}`);
    if (!races || races.length === 0) {
      console.log(`[info] ${date}の対象レースが見つかりませんでした`);
      return;
    }
    raceIds = races
      .map((r) => r.jv_race_key)
      .filter((k): k is string => !!k);
    console.log(`[info] ${date}: ${raceIds.length}レースのオッズを同期します`);
  }

  const summaries = await syncOddsForRaces(raceIds);

  const ok = summaries.filter((s) => s.status === "ok");
  const noOdds = summaries.filter((s) => s.status === "no_odds");
  const notFound = summaries.filter((s) => s.status === "race_not_found");
  const failed = summaries.filter((s) => s.status === "fetch_failed");
  const entries = ok.reduce((a, s) => a + s.entriesUpdated, 0);
  const combos = ok.reduce((a, s) => a + s.combinationsUpserted, 0);

  console.log(
    `\n[完了] 成功${ok.length}レース(単勝${entries}頭・組み合わせ${combos}件) / ` +
      `未発売${noOdds.length} / race未登録${notFound.length} / 失敗${failed.length}`,
  );
  if (failed.length > 0) {
    console.log("  失敗: " + failed.map((s) => s.netkeibaRaceId).join(", "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
