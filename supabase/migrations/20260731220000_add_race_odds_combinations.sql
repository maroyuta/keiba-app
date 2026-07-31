-- ============================================================
-- race_odds_combinations: 馬連・ワイドの現在オッズ(組み合わせ単位) (2026-07-31)
--
-- ギャップ: race_entries.odds_win(単勝)はJVRTOpen("0B31"→"0B30")経由で反映済みだが、
-- 「オッズ妙味の評価」ルール(CORE_RULES、人気同士の組み合わせも実際のワイド/馬連オッズ
-- 次第で妙味ありと判断してよい)が必要とする組み合わせオッズ(馬連・ワイド)を置く場所が
-- 無かった。race_payoutsはレース確定後の実配当専用(HR由来)であり、レース前の現在オッズとは
-- ライフサイクルが異なるため別テーブルとする。
--
-- データソース: scripts/jvlink/fetch_odds.py(JVRTOpen "0B30")→parse_records.pyのparse_o2
-- (馬連)/parse_o3(ワイド)→load_to_supabase.pyの--o2-csv/--o3-csvで反映(2026-07-31実装、
-- 実機の組み合わせ順序・人気順1位=最安オッズという整合性で検証済み。詳細はscripts/jvlink/
-- README.md参照)。
-- ------------------------------------------------------------
create table race_odds_combinations (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade,

  bet_type text not null check (bet_type in ('umaren', 'wide')),
  combination text not null, -- 馬番の組み合わせ(小さい方が先、例 '3-5')

  odds numeric,      -- 馬連用(単一オッズ)
  odds_low numeric,  -- ワイド用(下限)
  odds_high numeric, -- ワイド用(上限)
  popularity integer, -- その組み合わせの人気順

  data_source text not null default 'jv_link' check (data_source in ('jv_link', 'netkeiba')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (race_id, bet_type, combination)
);

create index race_odds_combinations_race_idx on race_odds_combinations (race_id);

create trigger race_odds_combinations_set_updated_at
  before update on race_odds_combinations
  for each row execute function set_updated_at();

alter table race_odds_combinations enable row level security;

create policy "Authenticated users can read race_odds_combinations" on race_odds_combinations
  for select using (auth.role() = 'authenticated');
