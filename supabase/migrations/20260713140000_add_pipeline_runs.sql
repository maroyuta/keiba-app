-- 週次バッチ(JV-Link同期・回収率算出・netkeiba過去走同期)の実行状況を記録する。
-- Windowsタスクスケジューラの実行結果はPC側でしか確認できず、無人稼働の失敗に
-- ユーザーが気づく手段が無かった(schtasksのLast Resultを手動で見に行くしかなかった)ため、
-- ブラウザ(/dashboard)から最終同期状況を確認できるようにする。
create table pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null check (job_name in (
    'jvlink_weekly_sync', 'compute_recommendation_results', 'sync_netkeiba_recent'
  )),
  status text not null check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  detail text
);

-- 「各jobの最新1件」を素早く引くためのインデックス。
create index pipeline_runs_job_name_started_at_idx on pipeline_runs (job_name, started_at desc);

alter table pipeline_runs enable row level security;

create policy "Authenticated users can read pipeline_runs" on pipeline_runs
  for select using (auth.role() = 'authenticated');
