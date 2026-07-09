-- 初期スキーマ (たたき台)
-- races / horses / race_entries / past_performances の4テーブル。
-- JV-LinkがWindows PC側からsupabase-jsまたはREST API経由でsyncする想定。
-- 詳細なカラム調整は次回以降で行う。

-- ============================================================
-- 共通: updated_at自動更新トリガー
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- races: レース情報
-- ============================================================
create table races (
  id uuid primary key default gen_random_uuid(),

  -- JV-Data由来の一意キー (場コード+開催年+回+日目+R番号を連結した文字列を想定)
  jv_race_key text not null unique,
  keibajo_code text not null,        -- 場コード (JV-Data: 01=札幌..10=小倉)
  keibajo_name text,                 -- 場名 (阪神, 東京 等)
  kaiji integer,                     -- 開催回
  nichiji integer,                   -- 開催日目
  race_number integer not null,      -- レース番号 (1-12)
  race_date date not null,
  post_time time,

  race_name text,
  grade text,                        -- G1/G2/G3/L/OP/3勝クラス 等 (自由記述)
  race_class text,

  track_type text not null check (track_type in ('芝', 'ダート', '障害')),
  distance_m integer not null,
  turn_direction text check (turn_direction in ('右', '左')), -- 直線コースはnull
  weather text,
  track_condition text check (track_condition in ('良', '稍重', '重', '不良')),

  entry_count integer,               -- 頭数

  -- トラックバイアス (土曜は直近の同場開催、日曜は前日の同場レースを参照して予測する)
  bias_note text,                    -- 内前有利/外差し 等の判定結果 (予測結果、または実況後の確定情報)
  bias_reference_race_id uuid references races(id) on delete set null, -- 予測根拠にした参照レース

  -- レース投資判断 (個別馬のランクとは別軸。S=価値・的中率とも高い、C=見送り推奨)
  race_rank text check (race_rank in ('S', 'A', 'B', 'C')),
  race_rank_reason text,

  -- 全体分析 (診断表下部5項目)
  analysis_level text,               -- 1. レース全体のレベル・層の厚さ
  analysis_favorite text,            -- 2. 本命が堅い/危ない理由
  analysis_rival text,               -- 3. 相手の根拠
  analysis_value text,               -- 4. 妙味馬が出る理由
  analysis_pace text,                -- 5. ペース・展開想定

  -- 買い目 (「本命→相手1頭」の1点。race_entries.horse_numberを参照、circular FK回避のためID参照はしない)
  honmei_horse_number integer,
  aite_horse_number integer,
  bet_type text check (bet_type in ('wide', 'umaren', 'both')), -- ワイド/馬連/両方
  bet_amount_wide integer,
  bet_amount_umaren integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index races_race_date_idx on races (race_date);
create index races_keibajo_date_idx on races (keibajo_code, race_date);

create trigger races_set_updated_at
  before update on races
  for each row execute function set_updated_at();

-- ============================================================
-- horses: 馬情報 (静的属性、絶対能力評価の土台)
-- ============================================================
create table horses (
  id uuid primary key default gen_random_uuid(),
  jv_horse_id text not null unique, -- JV-Data 血統登録番号

  horse_name text not null,
  sex text check (sex in ('牡', '牝', 'セ')),
  birth_date date,
  coat_color text,          -- 毛色
  sire_name text,            -- 父
  dam_name text,             -- 母
  dam_sire_name text,        -- 母父
  trainer_name text,         -- 現在の管理調教師
  trainer_affiliation text,  -- 美浦/栗東
  owner_name text,
  breeder_name text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index horses_horse_name_idx on horses (horse_name);
create index horses_sire_name_idx on horses (sire_name);
create index horses_dam_sire_name_idx on horses (dam_sire_name);

create trigger horses_set_updated_at
  before update on horses
  for each row execute function set_updated_at();

-- ============================================================
-- race_entries: 出走情報 (出馬表 + 診断表の個別馬列)
-- ============================================================
create table race_entries (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade,
  horse_id uuid not null references horses(id) on delete cascade,

  post_position integer not null,    -- 枠番
  horse_number integer not null,     -- 馬番

  jockey_name text,
  jockey_weight_kg numeric(4, 1),    -- 斤量
  trainer_name text,                 -- レース時点の調教師 (horses.trainer_nameの履歴的スナップショット)

  horse_weight_kg integer,           -- 馬体重
  horse_weight_diff_kg integer,      -- 前走比増減 (±10kg以上フラグ判定用)

  -- 装備変更 (4.5. 補助的加点材料)
  blinkers_change text check (blinkers_change in ('新規', '継続', '解除')),
  equipment_note text,

  -- オッズ・人気
  odds_win numeric(6, 1),            -- 単勝オッズ
  expected_popularity integer,       -- 想定人気 (診断表用)
  actual_popularity integer,         -- 確定人気 (レース後)

  -- 予想ロジック出力 (診断表の個別馬列: 枠・馬番・馬名・想定人気・S〜Cランク・短評)
  horse_rank text check (horse_rank in ('S', 'A', 'B', 'C')),
  horse_rank_comment text,           -- 短評 (1行)

  -- 枠順・消し判定 (断定的な「消し」は適性・能力が明らかに不足している馬のみ)
  is_kesshi boolean not null default false,
  kesshi_reason text,

  -- 結果 (レース確定後)
  finish_position integer,           -- 着順
  finish_time_sec numeric(5, 2),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (race_id, horse_number)
);

create index race_entries_race_id_idx on race_entries (race_id);
create index race_entries_horse_id_idx on race_entries (horse_id);

create trigger race_entries_set_updated_at
  before update on race_entries
  for each row execute function set_updated_at();

-- ============================================================
-- past_performances: 過去成績 (直近3走以上のリサーチ対象)
-- netkeiba/JV-Linkいずれのソースにも対応できるよう、races/race_entriesへの
-- FKは任意 (内部で追跡済みのレースであれば紐付け、そうでなければ単独で成立する)。
-- ============================================================
create table past_performances (
  id uuid primary key default gen_random_uuid(),
  horse_id uuid not null references horses(id) on delete cascade,

  -- 内部races/race_entriesと紐付く場合のみ設定 (任意)
  race_id uuid references races(id),
  race_entry_id uuid references race_entries(id),

  data_source text not null default 'netkeiba' check (data_source in ('jv_link', 'netkeiba')),
  source_url text,           -- netkeiba取得時の参照URL

  race_date date not null,
  keibajo_code text,
  keibajo_name text,
  race_number integer,
  race_name text,
  grade text,
  race_class text,

  track_type text check (track_type in ('芝', 'ダート', '障害')),
  distance_m integer,
  track_condition text check (track_condition in ('良', '稍重', '重', '不良')),
  weather text,
  entry_count integer,       -- 頭数 (レースレベル判断の参考)

  post_position integer,
  horse_number integer,
  jockey_name text,
  jockey_weight_kg numeric(4, 1),
  horse_weight_kg integer,
  horse_weight_diff_kg integer, -- ±10kg以上変動フラグ判定用

  odds_win numeric(6, 1),
  popularity integer,
  finish_position integer,
  finish_time_sec numeric(5, 2),
  margin_sec numeric(4, 2),  -- 着差 (秒換算、先頭は0)

  corner_positions text,     -- 通過順位 (例: "3-3-2-1")
  pace_mark text check (pace_mark in ('S', 'M', 'H')), -- スロー/ミドル/ハイ
  agari_3f_sec numeric(4, 1), -- 上がり3ハロンタイム

  -- リサーチルール: バイアス込みの不利、レース固有の不利、ペースからの有利不利
  bias_note text,            -- このレース時点のバイアス状況
  trouble_note text,         -- 出遅れ・包まれ・砂被り等の自由記述
  level_verification_note text, -- 対戦相手のその後の成績によるレースレベル裏取りメモ

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (horse_id, race_date, keibajo_code, race_number)
);

create index past_performances_horse_date_idx on past_performances (horse_id, race_date desc);

create trigger past_performances_set_updated_at
  before update on past_performances
  for each row execute function set_updated_at();

-- ============================================================
-- prediction_criteria: 予想軸マスタ
-- 予想軸の追加・変更・削除がスキーマ変更を伴わずに済むようにするための拡張ポイント。
-- 既存の固定軸 (絶対能力・ペース位置取り不利・トラックバイアス・装備変更・騎手要因・枠順データ) は
-- races/race_entriesの既存カラムのまま据え置き、ここでは「追加候補」として挙がっている
-- 厩舎の追い切りパターン・厩舎×騎手の組み合わせ・血統評価のような新規軸を対象にする。
-- ============================================================
create table prediction_criteria (
  id uuid primary key default gen_random_uuid(),
  criteria_key text not null unique,  -- プログラム上の識別子 (例: 'pedigree_aptitude', 'stable_oikiri_pattern')
  name text not null,                 -- 表示名
  description text,
  target_level text not null check (target_level in ('race', 'entry')), -- レース単位かレース内の個別馬単位か
  is_active boolean not null default true,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger prediction_criteria_set_updated_at
  before update on prediction_criteria
  for each row execute function set_updated_at();

-- race_entry_criteria_scores: 個別馬単位の軸スコア (target_level = 'entry' の軸用)
create table race_entry_criteria_scores (
  id uuid primary key default gen_random_uuid(),
  race_entry_id uuid not null references race_entries(id) on delete cascade,
  criteria_id uuid not null references prediction_criteria(id) on delete cascade,

  score numeric(5, 2),   -- 数値スコア (尺度は軸ごとに異なる)
  rank_mark text,        -- S/A/B/C等のランク表記が必要な軸用 (自由記述)
  reason text,           -- 根拠・短評
  raw_data jsonb,        -- 軸固有の構造化データ (必要な場合のみ)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (race_entry_id, criteria_id)
);

create index race_entry_criteria_scores_entry_idx on race_entry_criteria_scores (race_entry_id);
create index race_entry_criteria_scores_criteria_idx on race_entry_criteria_scores (criteria_id);

create trigger race_entry_criteria_scores_set_updated_at
  before update on race_entry_criteria_scores
  for each row execute function set_updated_at();

-- race_criteria_scores: レース単位の軸スコア (target_level = 'race' の軸用)
create table race_criteria_scores (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references races(id) on delete cascade,
  criteria_id uuid not null references prediction_criteria(id) on delete cascade,

  score numeric(5, 2),
  rank_mark text,
  reason text,
  raw_data jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (race_id, criteria_id)
);

create index race_criteria_scores_race_idx on race_criteria_scores (race_id);
create index race_criteria_scores_criteria_idx on race_criteria_scores (criteria_id);

create trigger race_criteria_scores_set_updated_at
  before update on race_criteria_scores
  for each row execute function set_updated_at();

-- ============================================================
-- training_sessions: 馬ごとの追い切り(調教)セッション記録
-- 厩舎ごとの追い切りパターン学習の元データ。
-- 厩舎×騎手の組み合わせパターンは、既存のrace_entries.jockey_name + horses.trainer_name
-- (またはrace_entries.trainer_nameの履歴スナップショット) の集計で足りるため、専用テーブルは設けない。
-- ============================================================
create table training_sessions (
  id uuid primary key default gen_random_uuid(),
  horse_id uuid not null references horses(id) on delete cascade,

  training_date date not null,
  course_type text check (course_type in ('坂路', 'ウッドチップ', 'ダート', '芝', 'プール', 'その他')),
  facility text,              -- 美浦/栗東/外厩名 等

  time_sec numeric(5, 2),     -- 主要区間タイム
  time_interval text,         -- 計測区間 (例: '4F', '5F-3F', 'ラスト1F')
  awase_uma text,             -- 併せ馬 (相手馬名、単走ならnull)
  awase_result text,          -- 併せ馬との優劣 (自由記述)
  ashi_iro text,              -- 脚色評価 (仕上矢印等、情報源の表記をそのまま格納)
  evaluator_comment text,     -- トラックマン評等のコメント

  data_source text not null,  -- 'jv_link' | 'keibabook' | 'jra' 等 (自由記述、確定次第check制約化を検討)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index training_sessions_horse_date_idx on training_sessions (horse_id, training_date desc);

create trigger training_sessions_set_updated_at
  before update on training_sessions
  for each row execute function set_updated_at();

-- ============================================================
-- sire_stats / nick_stats: 血統評価 (産駒傾向・配合パターン) の集計データ
-- horses.sire_name / horses.dam_sire_name を起点にテキストマッチで参照する。
-- 種牡馬自体がhorsesテーブルに行を持つとは限らない (海外種牡馬・引退済み等) ためFKにはしない。
-- ============================================================
create table sire_stats (
  id uuid primary key default gen_random_uuid(),
  sire_name text not null,

  stat_category text not null check (stat_category in ('distance_band', 'track_type', 'course')),
  stat_key text not null,      -- category次第 (例: '1600-1800m' / '芝' / '阪神芝1200m')

  starts integer,
  wins integer,
  win_rate numeric(5, 2),
  place_rate numeric(5, 2),    -- 複勝率

  data_source text not null,   -- 'jbis' | 'studbook' | 'jv_link' 等
  as_of_date date,             -- 集計時点

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (sire_name, stat_category, stat_key, data_source)
);

create index sire_stats_sire_idx on sire_stats (sire_name);

create trigger sire_stats_set_updated_at
  before update on sire_stats
  for each row execute function set_updated_at();

create table nick_stats (
  id uuid primary key default gen_random_uuid(),
  sire_name text not null,
  dam_sire_name text not null,

  starts integer,
  wins integer,
  win_rate numeric(5, 2),
  place_rate numeric(5, 2),

  data_source text not null,
  as_of_date date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (sire_name, dam_sire_name, data_source)
);

create index nick_stats_pair_idx on nick_stats (sire_name, dam_sire_name);

create trigger nick_stats_set_updated_at
  before update on nick_stats
  for each row execute function set_updated_at();

-- ============================================================
-- RLS (最小限。詳細なポリシー設計は次回)
-- service_role (JV-LinkからのsyncスクリプトやAPI Route) はRLSを常にバイパスする。
-- ============================================================
alter table races enable row level security;
alter table horses enable row level security;
alter table race_entries enable row level security;
alter table past_performances enable row level security;
alter table prediction_criteria enable row level security;
alter table race_entry_criteria_scores enable row level security;
alter table race_criteria_scores enable row level security;
alter table training_sessions enable row level security;
alter table sire_stats enable row level security;
alter table nick_stats enable row level security;

create policy "Authenticated users can read races" on races
  for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read horses" on horses
  for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read race_entries" on race_entries
  for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read past_performances" on past_performances
  for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read prediction_criteria" on prediction_criteria
  for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read race_entry_criteria_scores" on race_entry_criteria_scores
  for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read race_criteria_scores" on race_criteria_scores
  for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read training_sessions" on training_sessions
  for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read sire_stats" on sire_stats
  for select using (auth.role() = 'authenticated');
create policy "Authenticated users can read nick_stats" on nick_stats
  for select using (auth.role() = 'authenticated');
