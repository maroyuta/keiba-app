-- コース(会場×芝ダ×距離)ごとの「同時期・多年」トラックバイアスプロファイルを保存する。
-- 背景: 従来のバイアス予測は findBiasReferenceRaces が直近1-2レースの bias_note を拾うだけで、
-- 参照が薄く確信度が低かった(2026-08-08、新潟の実診断で bias_note が「2026-08-02の1件のみ」を
-- 根拠にしていた)。実データを見ると、脚質の「前有利」は新潟夏で3年連続10pt前後と構造的に強い一方、
-- 枠(内外)の向きはコースで逆転する(芝1000=外有利/芝1800=内有利/芝2000=外有利、ダ1200=フラット等)。
-- つまりバイアスは「会場」ではなく「会場×芝ダ×距離」単位で、同時期・多年で見るのが正しい。
-- このテーブルは compute_course_bias.py が週次で(実行日の±window_days×直近数年)から算出して upsert し、
-- 診断時(route.ts)が (keibajo_code, track_type, distance_m) で引いてプロンプトへ構造的バイアスとして渡す。
-- 週次で「今の時期」基準に再計算されるため、常に季節(馬場の状態)が合ったプロファイルになる。

CREATE TABLE IF NOT EXISTS public.course_bias_profiles (
  keibajo_code   text    NOT NULL,
  track_type     text    NOT NULL,   -- 芝 / ダート
  distance_m     integer NOT NULL,
  runs           integer NOT NULL,   -- 集計に使った延べ出走数
  years_covered  integer NOT NULL,   -- 集計対象に含まれた開催年数(多年一貫性の母数)

  -- 脚質バイアス。fin_pct = finish_position/entry_count の平均(低いほど好走)。
  front_pct        numeric,          -- 先行勢(先頭2角平均÷頭数<=0.35)の平均着順%
  back_pct         numeric,          -- 差し・追込勢の平均着順%
  style_gap        numeric,          -- back_pct - front_pct。正なら前有利(前の方が着順が良い)
  style_label      text,             -- 前有利 / 後方有利 / フラット
  style_confidence text,             -- 高 / 中 / 低(サンプル数×多年一貫性で判定)

  -- 枠バイアス。
  inner_pct        numeric,          -- 内枠(1-4枠)の平均着順%
  outer_pct        numeric,          -- 外枠(5-8枠)の平均着順%
  waku_gap         numeric,          -- outer_pct - inner_pct。正なら内枠有利
  waku_label       text,             -- 内枠有利 / 外枠有利 / フラット
  waku_confidence  text,

  window_days   integer,             -- 同時期とみなした±日数(季節窓)
  summary_note  text,                -- プロンプトへ渡す一言サマリ
  computed_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (keibajo_code, track_type, distance_m)
);

COMMENT ON TABLE public.course_bias_profiles IS 'コース(会場×芝ダ×距離)ごとの同時期・多年トラックバイアスプロファイル。compute_course_bias.py が週次で再計算';
