-- 「相手(aite)を1頭だけだと的中率が低すぎる」というユーザー指摘への対応(2026-07-21)。
-- 買い目を「本命→相手最大2頭」に拡張する。2頭目は任意(妥当な候補が無ければnullのまま)。
-- 予算は相手1頭あたり5,000円(2頭なら合計10,000円/レース)。prompts.tsの「馬券方針」「購入金額の配分」節参照。
alter table races
  add column aite_horse_number_2 integer,
  add column bet_amount_wide_2 integer,
  add column bet_amount_umaren_2 integer;

comment on column races.aite_horse_number_2 is
  '2人目の相手馬番。任意(妥当な候補が無ければnull)。1人目のaite_horse_numberと合わせて本命との組み合わせをそれぞれ判定する。';
comment on column races.bet_amount_wide_2 is
  '本命×aite_horse_number_2のワイド購入額。aite_horse_number_2がnullの場合はnull。';
comment on column races.bet_amount_umaren_2 is
  '本命×aite_horse_number_2の馬連購入額。aite_horse_number_2がnullの場合はnull。';

alter table race_recommendation_results
  add column aite_horse_number_2 integer;

comment on column race_recommendation_results.aite_horse_number_2 is
  '計算時点でのraces.aite_horse_number_2のスナップショット。stake_yen/return_yenは相手1・2の合算値。';
