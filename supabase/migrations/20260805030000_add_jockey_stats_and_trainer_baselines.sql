-- ============================================================
-- jockey_stats: 騎手のコース・馬場・距離帯別成績 (2026-08-05)
-- sire_stats/nick_statsと全く同じ設計思想。past_performances.jockey_name(テキスト)を
-- 起点に自前集計する。騎手も引退・移籍等でhorsesのような正規化テーブルを持たないため
-- FKにはせずtextマッチ。
-- ============================================================
create table jockey_stats (
  id uuid primary key default gen_random_uuid(),
  jockey_name text not null,

  stat_category text not null check (stat_category in ('distance_band', 'track_type', 'course')),
  stat_key text not null,      -- category次第 (例: '1600-1800m' / '芝' / '阪神')

  starts integer,
  wins integer,
  win_rate numeric(5, 2),
  place_rate numeric(5, 2),
  roi_win_pct numeric(6, 2),   -- 単勝回収率 (%)、100が収支トントン

  data_source text not null,
  as_of_date date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (jockey_name, stat_category, stat_key, data_source)
);

create index jockey_stats_jockey_idx on jockey_stats (jockey_name);

create trigger jockey_stats_set_updated_at
  before update on jockey_stats
  for each row execute function set_updated_at();

alter table jockey_stats enable row level security;

create policy "Authenticated users can read jockey_stats" on jockey_stats
  for select using (auth.role() = 'authenticated');

-- ============================================================
-- trainer_training_baselines: 調教師(厩舎)単位の坂路/ウッドチップ総合タイムの
-- 平均・標準偏差 (2026-08-05)。個々のtraining_sessions.total_time_secが、その厩舎に
-- とって「いつも通り」か「気配良好(本気モード)」かを相対評価するためのベースライン。
-- AGENTS.mdの「調教評価の設計方針」(絶対タイムでの閾値判定はしない、自己・厩舎単位の
-- 相対比較を基本にする)に基づく設計。training_sessions再設計時(20260710070000)から
-- 「次回以降の実装課題」として積み残されていたもの(区間タイム自体が無かったため
-- 実装不可能だったが、2026-08-05にSLOPの区間タイムが確定し可能になった)。
-- ============================================================
create table trainer_training_baselines (
  id uuid primary key default gen_random_uuid(),
  trainer_name text not null,
  training_type text not null check (training_type in ('坂路', 'ウッドチップ')),

  sample_size integer not null,
  avg_total_time_sec numeric(5, 2),
  stddev_total_time_sec numeric(5, 2),

  computed_at timestamptz not null default now(),

  unique (trainer_name, training_type)
);

create index trainer_training_baselines_trainer_idx on trainer_training_baselines (trainer_name);

alter table trainer_training_baselines enable row level security;

create policy "Authenticated users can read trainer_training_baselines" on trainer_training_baselines
  for select using (auth.role() = 'authenticated');
