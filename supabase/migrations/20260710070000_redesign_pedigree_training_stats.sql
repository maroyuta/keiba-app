-- ============================================================
-- 血統・調教・種牡馬統計テーブルの再設計 (2026-07-10)
-- JV-Data BLOD(産駒マスタ「SK」)・SLOP(坂路調教情報「HC」)/WOOD(ウッドチップ調教情報「WC」)の
-- 実際のレコード構造が判明したため、既存の汎用設計とのズレを解消する。
-- 詳細はAGENTS.mdの「データソース」節 (追い切り・血統データソースの確定) を参照。
-- 本番データはまだ一切投入されていない前提 (JV-Link未接続) のため、
-- training_sessions/nick_statsは破壊的に作り直す。実データ投入後にスキーマを
-- 変える場合は、この方式ではなくバックフィル付きのALTERにすること。
-- ============================================================

-- ------------------------------------------------------------
-- horse_pedigrees: 3代血統 (JV-Data BLOD「産駒マスタ(SK)」準拠、14頭分)
-- horses.sire_name/dam_name/dam_sire_nameは1〜2世代までの簡易参照として
-- 既存コード (serializeHorse等) との互換のためそのまま残し、より深い血統樹は
-- こちらで別管理する。繁殖馬(種牡馬・牝馬)自体はhorsesに行を持つとは限らない
-- (海外種牡馬・引退済み等) ためFKにはせず、全て自由記述のtextで保持する。
-- ------------------------------------------------------------
create table horse_pedigrees (
  id uuid primary key default gen_random_uuid(),
  horse_id uuid not null references horses(id) on delete cascade unique,

  sire_name text,              -- 父
  dam_name text,               -- 母
  sire_sire_name text,         -- 父父
  sire_dam_name text,          -- 父母
  dam_sire_name text,          -- 母父
  dam_dam_name text,           -- 母母
  sire_sire_sire_name text,    -- 父父父
  sire_sire_dam_name text,     -- 父父母
  sire_dam_sire_name text,     -- 父母父
  sire_dam_dam_name text,      -- 父母母
  dam_sire_sire_name text,     -- 母父父
  dam_sire_dam_name text,      -- 母父母
  dam_dam_sire_name text,      -- 母母父
  dam_dam_dam_name text,       -- 母母母

  data_source text not null default 'jv_link' check (data_source in ('jv_link', 'netkeiba')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger horse_pedigrees_set_updated_at
  before update on horse_pedigrees
  for each row execute function set_updated_at();

alter table horse_pedigrees enable row level security;

create policy "Authenticated users can read horse_pedigrees" on horse_pedigrees
  for select using (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- training_sessions: HC(坂路)/WC(ウッドチップ)の実データ構造 (800M/2000Mから200M刻みの
-- 区間タイムを複数持つ) に合わせて再設計。旧設計 (course_type/time_sec/time_intervalの
-- 自由記述) では表現しきれないため作り直す。
--
-- 調教評価の設計方針 (AGENTS.md参照): 絶対タイムでの閾値判定はしない。厩舎単位・馬個体単位、
-- それぞれの過去セッションとの相対比較がベースになるため、集計キーとなるtrainer_nameを
-- スナップショットで保持する (horses.trainer_nameは現在の管理調教師のみで、乗り替わり時の
-- 履歴を追えないため)。
-- ------------------------------------------------------------
drop table training_sessions;

create table training_sessions (
  id uuid primary key default gen_random_uuid(),
  horse_id uuid not null references horses(id) on delete cascade,
  trainer_name text,          -- 調教時点の管理調教師 (厩舎単位の集計用スナップショット)

  training_date date not null,
  training_time time,
  training_type text not null check (training_type in ('坂路', 'ウッドチップ')),
  facility text check (facility in ('美浦', '栗東')),
  course_code text,           -- ウッドチップのみ: コース (A〜E)
  turn_direction text check (turn_direction in ('右', '左')), -- ウッドチップのみ: 馬場周り

  -- ゴール手前メートル数をキーにしたラップタイム(秒)のJSONB。
  -- 例: {"800": 52.3, "600": 38.1, "400": 24.0, "200": 12.1}
  -- 坂路は800Mから、ウッドチップは最大2000Mからの200M刻み。区間数はコース・仕様変更で
  -- 変わりうるため固定カラムにせずJSONBで持つ。
  lap_times_sec jsonb not null,
  total_time_sec numeric(5, 2), -- 主要区間 (4F等) の合計タイム。集計・ソート用に非正規化して保持

  awase_uma text,              -- 併せ馬 (相手馬名、単走ならnull)
  awase_result text,           -- 併せ馬との優劣 (自由記述)
  ashi_iro text,                -- 脚色評価 (仕上矢印等、情報源の表記をそのまま格納)
  evaluator_comment text,      -- トラックマン評等のコメント

  data_source text not null default 'jv_link' check (data_source in ('jv_link', 'keibabook', 'jra')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index training_sessions_horse_date_idx on training_sessions (horse_id, training_date desc);
create index training_sessions_trainer_date_idx on training_sessions (trainer_name, training_date desc);

create trigger training_sessions_set_updated_at
  before update on training_sessions
  for each row execute function set_updated_at();

alter table training_sessions enable row level security;

create policy "Authenticated users can read training_sessions" on training_sessions
  for select using (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- sire_stats / nick_stats: 回収率(roi_win_pct)を追加する。
-- 「オッズ妙味の評価」方針の通り、的中率(win_rate/place_rate)だけでなく回収率ベースで
-- 判断するため、自前集計(past_performances.odds_win等の蓄積から算出)の主指標をROIにする。
-- nick_statsにもsire_statsと同じ粒度(距離帯/馬場/コース)のセグメントを持たせ、
-- 「父×母父」全体だけでなく条件別の配合傾向も見られるようにする。
-- ------------------------------------------------------------
alter table sire_stats add column roi_win_pct numeric(6, 2); -- 単勝回収率 (%)、100が収支トントン

drop table nick_stats;

create table nick_stats (
  id uuid primary key default gen_random_uuid(),
  sire_name text not null,
  dam_sire_name text not null,

  stat_category text not null check (stat_category in ('distance_band', 'track_type', 'course')),
  stat_key text not null,      -- category次第 (例: '1600-1800m' / '芝' / '阪神芝1200m')

  starts integer,
  wins integer,
  win_rate numeric(5, 2),
  place_rate numeric(5, 2),
  roi_win_pct numeric(6, 2),   -- 単勝回収率 (%)、100が収支トントン

  data_source text not null,
  as_of_date date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (sire_name, dam_sire_name, stat_category, stat_key, data_source)
);

create index nick_stats_pair_idx on nick_stats (sire_name, dam_sire_name);

create trigger nick_stats_set_updated_at
  before update on nick_stats
  for each row execute function set_updated_at();

alter table nick_stats enable row level security;

create policy "Authenticated users can read nick_stats" on nick_stats
  for select using (auth.role() = 'authenticated');
