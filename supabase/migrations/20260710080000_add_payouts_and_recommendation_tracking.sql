-- ============================================================
-- race_payouts / race_recommendation_results: 実際の配当・推奨結果の追跡 (2026-07-10)
--
-- ギャップ: 「回収率重視」を掲げているが、確定後の実際の配当・推奨(honmei/aite)が
-- 的中したかを記録するテーブルが一つも無かった。races.honmei_horse_number等は
-- 「診断が出した予想」のスナップショットとしては存在するが、それが実際どうなったかを
-- 追跡する仕組みがなく、システムの実運用回収率を検証できない状態だった。
-- ============================================================

-- ------------------------------------------------------------
-- race_payouts: レース確定後の実際の払戻金(公式配当)
-- ✅ 2026-07-11: JV-Dataの配当情報レコード(HR, JV_HR_PAY構造体)のバイトオフセットを
-- JVData_Struct.csで確認し、scripts/jvlink/parse_records.pyのparse_hr()で実装済み。
-- scripts/jvlink/load_to_supabase.pyの--hr-csvオプションでこのテーブルへupsertする
-- (combination/payout_yenはnetkeiba実データと完全一致を確認済み。詳細はscripts/jvlink/README.md参照)。
-- ------------------------------------------------------------
create table race_payouts (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade,

  bet_type text not null check (
    bet_type in ('win', 'place', 'wakuren', 'umaren', 'wide', 'umatan', 'sanrenpuku', 'sanrentan')
  ),
  combination text not null,   -- 馬番の組み合わせ (例: 単勝'3'、ワイド'3-5'、三連単は着順込み'3-5-7')
  payout_yen integer not null, -- 100円あたりの払戻金
  popularity integer,          -- その組み合わせの人気順 (万馬券等の把握用)

  data_source text not null default 'jv_link' check (data_source in ('jv_link', 'netkeiba')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (race_id, bet_type, combination)
);

create index race_payouts_race_idx on race_payouts (race_id);

create trigger race_payouts_set_updated_at
  before update on race_payouts
  for each row execute function set_updated_at();

alter table race_payouts enable row level security;

create policy "Authenticated users can read race_payouts" on race_payouts
  for select using (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- race_recommendation_results: 診断が出したhonmei/aite推奨が、確定後に
-- 実際どうだったか。races.honmei_horse_number等は再診断のたびに上書きされうるため、
-- 「その時点で実際に賭けた想定の推奨」を別途スナップショットとして残す。
-- レース確定後、race_payoutsと突き合わせて的中・回収率を計算するバッチで埋める想定。
-- ✅ 2026-07-11: scripts/compute_recommendation_results.pyとして実装済み(詳細はAGENTS.md参照)。
-- ------------------------------------------------------------
create table race_recommendation_results (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade unique,

  bet_type text check (bet_type in ('wide', 'umaren', 'both')),
  honmei_horse_number integer,
  aite_horse_number integer,
  stake_yen integer,       -- 診断時点のbet_amount_wide + bet_amount_umarenの合計スナップショット

  is_hit boolean,          -- 実際に的中したか
  return_yen integer,      -- 実際の払戻金額 (的中時のみ、race_payoutsから算出)
  roi_pct numeric(6, 2),   -- return_yen / stake_yen * 100 (100が収支トントン)

  computed_at timestamptz, -- このレース確定・集計を行った時刻

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger race_recommendation_results_set_updated_at
  before update on race_recommendation_results
  for each row execute function set_updated_at();

alter table race_recommendation_results enable row level security;

create policy "Authenticated users can read race_recommendation_results" on race_recommendation_results
  for select using (auth.role() = 'authenticated');
