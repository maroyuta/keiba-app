-- scripts/compute_past_performance_bias.pyから、past_performances.bias_noteだけを
-- 行ごとに違う値で一括更新するためのRPC。PostgRESTのon_conflict upsertは対象行が
-- 既存でも「新規INSERT相当」の行を組み立てようとし、payloadに含めていない列(horse_id等、
-- NOT NULL)がnullとして扱われてエラーになることが判明した(2026-08-05)。1行ずつPATCHするのは
-- 5万件超では非現実的な速度になるため、jsonb_to_recordsetでまとめて渡しSQL側で一括UPDATEする。
create or replace function bulk_update_past_performance_bias(updates jsonb)
returns void
language sql
as $$
  update past_performances pp
  set bias_note = u.bias_note
  from jsonb_to_recordset(updates) as u(id uuid, bias_note text)
  where pp.id = u.id;
$$;
