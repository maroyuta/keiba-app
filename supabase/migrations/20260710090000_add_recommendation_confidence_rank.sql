-- ============================================================
-- race_recommendation_resultsに確定時のrace_rank(自信度)を追加 (2026-07-10)
-- ダッシュボードで「自信度(S/A/B/C)ごとの回収率」を races への
-- joinなしで直接集計できるようにする(races.race_rankは再診断で上書きされうるため、
-- 決済バッチ実行時点のスナップショットとして別途持つ)。
-- ============================================================
alter table race_recommendation_results
  add column race_rank text check (race_rank in ('S', 'A', 'B', 'C'));

create index race_recommendation_results_race_rank_idx
  on race_recommendation_results (race_rank);
