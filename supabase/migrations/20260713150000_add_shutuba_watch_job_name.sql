-- sync:netkeiba:shutuba-watch(Mac側launchdで毎日実行、出馬表の先回り同期)を
-- pipeline_runsの記録対象job_nameに追加する。
alter table pipeline_runs drop constraint pipeline_runs_job_name_check;
alter table pipeline_runs add constraint pipeline_runs_job_name_check check (job_name in (
  'jvlink_weekly_sync', 'compute_recommendation_results', 'sync_netkeiba_recent', 'sync_netkeiba_shutuba'
));
