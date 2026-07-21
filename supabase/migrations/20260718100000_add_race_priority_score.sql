-- 「S/A評価のレースが多すぎて5〜6レースに絞れない」問題への対応(2026-07-18)。
-- race_rankは4段階のカテゴリのみで、同じA評価内での優先順位が付けられなかった。
-- 診断が自己申告する妙味(EV)の強さを0-100の連続値で持たせ、S/A内での並び替えを可能にする。
alter table races
  add column race_priority_score integer;

comment on column races.race_priority_score is
  '診断が自己申告する妙味(EV)の強さ(0-100)。race_rank(S/A/B/C)のカテゴリ内での優先順位付けに使う。高いほど自信度が高い。screening/standardではnullのままでよく、実際に買い目が組まれるstandard/premium診断でのみ設定される想定。';
