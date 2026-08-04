-- SE(馬毎レース情報)のblinkerフラグ("今回使用するか"の0/1)をそのまま保持する列。
-- blinkers_change(新規/継続/解除)は「前走との比較」でしか導出できないため、次回以降の
-- 同馬のロード時にこの列を参照して差分判定する(scripts/jvlink/load_to_supabase.py参照)。
alter table race_entries add column blinker_raw boolean;

comment on column race_entries.blinker_raw is
  'SEレコードのblinkerフラグ(今回このレースでブリンカーを使用したか)。blinkers_change算出用の生データ。';
