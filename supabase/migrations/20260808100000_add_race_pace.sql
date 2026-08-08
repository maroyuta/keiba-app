-- レースのペース(前半3F/後半3F・ラップ)を格納する列を races に追加する。
-- 背景: JV-Link の RA レコードは前半3ハロン(haron_time_s3)・後半3ハロン(haron_time_l3)・
-- 1ハロンごとのラップ25本(lap_time_1..25)を配信しており、scripts/jvlink/parse_records.py の
-- parse_ra() は既にこれらを切り出しているが、load_to_supabase.py が races へ載せていなかったため
-- DB には一切ペース情報が無かった(analysis_pace は LLM が診断時に書く自由文で、実測値ではない)。
-- トラックバイアスの機械判定(compute_actual_bias.py 等)が「前有利」を出しても、それが本物の
-- 前有利なのか単にスローペースで前が残っただけなのかを区別できないのが最大の弱点だった。
-- この実測ペースを保存し、バイアス判定の裏取りに使う。
--
-- 単位: 秒(JV-Data の1/10秒スケールを load 側で /10 して格納)。
-- first_3f_sec = 前半3ハロンタイム、last_3f_sec = 後半3ハロン(=上がり3F)タイム。
-- lap_times_sec = レース先頭からの1ハロンごとのラップ秒の配列(0埋め・空欄は除外)。

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS first_3f_sec numeric,
  ADD COLUMN IF NOT EXISTS last_3f_sec numeric,
  ADD COLUMN IF NOT EXISTS lap_times_sec jsonb;

COMMENT ON COLUMN public.races.first_3f_sec IS '前半3ハロンタイム(秒)。JV-Link RA haron_time_s3 由来。レースの序盤ペース指標';
COMMENT ON COLUMN public.races.last_3f_sec  IS '後半3ハロン(上がり3F)タイム(秒)。JV-Link RA haron_time_l3 由来。first_3f_sec との差でペースの前傾/後傾を判定する';
COMMENT ON COLUMN public.races.lap_times_sec IS '先頭からの1ハロンごとのラップ秒の配列(jsonb)。JV-Link RA lap_time_1..25 由来、0埋め/空欄は除外';
