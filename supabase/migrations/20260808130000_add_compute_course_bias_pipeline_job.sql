-- compute_course_bias.py(コース別・同時期・多年バイアスの週次バッチ)を pipeline_runs の
-- job_name チェック制約に追加する。これが無いと start_pipeline_run が 400 で弾かれ、実行記録が残らない
-- (バッチ自体は非致命として継続するが、他バッチと同様に実行履歴を残せるようにする)。

ALTER TABLE public.pipeline_runs DROP CONSTRAINT IF EXISTS pipeline_runs_job_name_check;
ALTER TABLE public.pipeline_runs ADD CONSTRAINT pipeline_runs_job_name_check CHECK (
  job_name = ANY (ARRAY[
    'jvlink_weekly_sync','compute_recommendation_results','sync_netkeiba_recent',
    'sync_netkeiba_shutuba','compute_actual_bias','compute_past_performance_bias',
    'compute_sire_nick_stats','compute_jockey_stats','compute_trainer_baselines',
    'compute_course_bias'
  ])
);
