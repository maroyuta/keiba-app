-- 「本気診断(premium/Opus)が完了したかどうか自分で判断がつかない」というユーザー指摘への対応
-- (2026-07-19)。UIに済マークを出すため、premium診断が実際にコミットされた時刻を記録する。
alter table races
  add column premium_diagnosed_at timestamptz;

comment on column races.premium_diagnosed_at is
  '本気診断(premium/Opusティア)の結果が最後にDBへ書き込まれた時刻。nullなら本気診断は未完了。UIの「済」バッジ表示に使う。';
