-- Claude API呼び出しの実測トークン数・推定コストを記録する。
-- 「たくさん予想して精度を見たいが、コストは抑えたい」という運用判断のための実測データ。
create table api_usage_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  race_id uuid references races(id) on delete set null,
  tier text not null check (tier in ('screening', 'standard', 'premium')),
  model text not null,

  input_tokens integer not null,
  output_tokens integer not null,       -- adaptive thinkingのトークンもここに含まれる (通常のoutputと同じ単価で課金されるため)
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,

  estimated_cost_usd numeric(10, 6) not null,
  duration_ms integer
);

create index api_usage_log_race_id_idx on api_usage_log (race_id);
create index api_usage_log_created_at_idx on api_usage_log (created_at desc);

alter table api_usage_log enable row level security;

create policy "Authenticated users can read api_usage_log" on api_usage_log
  for select using (auth.role() = 'authenticated');
