import { readFile } from "node:fs/promises";
import { join } from "node:path";
import subsetFont from "subset-font";

// Noto Sans JP(OFL)のフルセットは4.5MB/ウェイトあり、satoriに毎回食わせると
// レンダリングが重いため、カードに実際に載る文字だけへ都度サブセットして渡す。
// フォント本体の読み込みはプロセス内で1回だけ。
let regularPromise: Promise<Buffer> | null = null;
let boldPromise: Promise<Buffer> | null = null;

function loadFont(file: string): Promise<Buffer> {
  return readFile(join(process.cwd(), "assets", "fonts", file));
}

// カードテンプレート側の固定ラベルで使う文字。動的テキスト(馬名・レース名・短評)は
// 呼び出し側がdynamicTextとして渡す。
const BASE_CHARS =
  "0123456789" +
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  " .,:;!?%&()[]{}+-*/=_~^#@'\"|→◎○▲△×—…・٫" +
  "円件頭番人気倍率的中購入投資払戻回収累計結果予想診断買い目本命相手券種" +
  "ワイド馬連単複勝枠芝ダート障害良稍重不メモ" +
  "レースランク妙味危険な消し軸級押さえ軽視〜見送り対象外" +
  "月火水木金土日年開催場発走前公開はもれ全部残します" +
  "AI競馬アナリスト勝クラス未新戦歳以上オープンリステッド重賞" +
  "馬券は自己責任で歳未満の勝馬投票券の購入は禁止されています" +
  "きょうのあすしごはん狙撃沈引分速報自動集計システム手動なし正直運用中";

export type SnsFont = {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
};

export async function buildFonts(dynamicText: string): Promise<SnsFont[]> {
  regularPromise ??= loadFont("NotoSansJP-Regular.otf");
  boldPromise ??= loadFont("NotoSansJP-Bold.otf");
  const [regular, bold] = await Promise.all([regularPromise, boldPromise]);

  const chars = BASE_CHARS + dynamicText;
  const [subsetRegular, subsetBold] = await Promise.all([
    subsetFont(regular, chars, { targetFormat: "sfnt" }),
    subsetFont(bold, chars, { targetFormat: "sfnt" }),
  ]);

  return [
    { name: "Noto Sans JP", data: subsetRegular, weight: 400, style: "normal" },
    { name: "Noto Sans JP", data: subsetBold, weight: 700, style: "normal" },
  ];
}
