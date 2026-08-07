import { redirect } from "next/navigation";

// サイトを開いた瞬間に「今日のレース」を見せるため、トップは/racesへ即リダイレクトする
// (/races側はdate未指定ならJST基準の今日を単日表示する)。以前のランディング(競馬予想の
// 説明+レース一覧/回収率ボタン)は、開くたびに1クリック挟まって煩わしいとの指摘で廃止。
// 回収率ダッシュボードへは/races内のヘッダーリンクから辿れる。
export default function Home() {
  redirect("/races");
}
