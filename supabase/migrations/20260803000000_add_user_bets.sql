-- ============================================================
-- user_bets: ユーザー自身の実購入記録(「俺アレンジ」、AI推奨とは別に本人がIPAT等で
-- 実際に買った馬券) (2026-08-03)
--
-- ギャップ: race_recommendation_resultsはAI推奨(honmei/aite)専用で、ユーザー自身が
-- 全頭診断を参考に組んだ実購入(AI推奨と異なる組み合わせ・複数点買い等)を記録する場所が
-- 無かった。これまではAGENTS.mdへの手打ちメモ頼みで、内訳の聞き漏れ・値の食い違いが
-- 複数回発生した(2026-08-02の回収率検証セッション参照)。
--
-- 使い方: レース後にユーザーがチャットで「新潟6R、1-4でワイド4000+馬連600」のように伝えたら
-- そのままこのテーブルにinsertする。回収率はrace_payoutsとの素朴なjoinで都度計算する
-- (return_yen = payout_yen * stake_yen / 100、100円単位払戻のJRA標準に合わせる)。
-- 専用の集計バッチは設けない(race_recommendation_resultsと違って書き込み頻度が低く、
-- 都度SQLで十分なため)。
-- ------------------------------------------------------------
create table user_bets (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade,

  bet_type text not null check (bet_type in ('win', 'place', 'wakuren', 'umaren', 'wide', 'umatan', 'sanrenpuku', 'sanrentan')),
  combination text not null, -- 馬番の組み合わせ、小さい方が先(例 '2-14')。単勝/複勝は馬番1つのみ
  stake_yen integer not null,

  note text, -- 任意メモ(例: 「内訳スクショ未確認」等、あとで確認が要る場合の目印)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_bets_race_idx on user_bets (race_id);

create trigger user_bets_set_updated_at
  before update on user_bets
  for each row execute function set_updated_at();

alter table user_bets enable row level security;

create policy "Authenticated users can read user_bets" on user_bets
  for select using (auth.role() = 'authenticated');
