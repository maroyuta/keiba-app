-- training_sessionsには元々一意制約が無く、load_to_supabase.pyから毎回INSERTすると
-- 再実行のたびに重複行が積み上がってしまう(他のテーブルはon_conflictでupsertする設計だが、
-- training_sessionsだけ書き込みコードが無いまま2026-07-10に先に作られていた)。
-- 同じ馬の同じ調教日時に複数種別(坂路/ウッドチップ)が記録されることはあってもレコード自体は
-- 1件のはずなので、(horse_id, training_date, training_time, training_type)を一意キーにする。
alter table training_sessions
  add constraint training_sessions_horse_date_time_type_key
  unique (horse_id, training_date, training_time, training_type);
