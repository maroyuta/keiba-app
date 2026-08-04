-- scripts/compute_actual_bias.py (races.actual_bias_noteの自動計算バッチ、2026-08-04新設)を
-- pipeline_runsの可視化対象job_nameに追加する。
alter table pipeline_runs drop constraint pipeline_runs_job_name_check;
alter table pipeline_runs add constraint pipeline_runs_job_name_check
  check (job_name = any (array['jvlink_weekly_sync','compute_recommendation_results','sync_netkeiba_recent','sync_netkeiba_shutuba','compute_actual_bias']));
