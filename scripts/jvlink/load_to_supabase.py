"""RA_parsed.csv / SE_parsed.csvを読み込み、Supabaseのraces/horses/race_entriesへupsertする。

Windows側のfetch_raw.py + parse_records.pyが生成したCSVを入力とする。このスクリプト自体は
JV-Link COMに依存しない(標準ライブラリのみ使用)ため、Mac/Windowsどちらでも実行できる。

前提:
- RA_parsed.csv (レース詳細) / SE_parsed.csv (馬毎レース情報) が手元にあること
- 環境変数 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていること
  (.env.localと同じ値。--env-fileオプションでファイルから読み込むことも可能)

✅ JV-Dataコード変換の実データ検証について (2026-07-11):
track_type/grade/weather/track_condition/odds_win/jockey_weight_kg/finish_time_secは、
小倉11R「北九州記念」(G3、2026-07-05、race_id=202610020411)をnetkeibaの結果ページと
突き合わせ、出走13頭全頭・レース情報ともに完全一致することを確認済み(詳細は
scripts/jvlink/README.mdの「load_to_supabase.pyの既知の制約・要検証事項」参照)。
唯一、horse_weight_diff_kgは実際の増減0kgのケースを計測不能(None)と区別できていない
軽微な既知の粗が残っている(回収率計算には影響しない)。

JG(競走馬除外情報)は現状このスクリプトでは扱わない。race_entriesスキーマに
「除外」を表す適切な列が無く、is_kesshi/kesshi_reasonは別目的(診断ロジックの消し判定)の
列のため、意味を混同しないよう意図的に未対応としている。

HR(払戻情報)は`--hr-csv`で任意指定すると`race_payouts`へupsertする。race_idの解決は
このスクリプト内で行ったraces upsertの結果を優先し、無ければSupabaseへ`jv_race_key`で
問い合わせて解決する(HR_parsed.csv単体で走らせても動くようにするため)。
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# 週次の無人実行中に単発のネットワーク瞬断でバッチ全体が落ちる事故を防ぐための設定。
# タイムアウト未設定のurlopenは応答が返らない限り無期限に固まる(2026-07-12、
# netkeibaスクレイパーのfetch()で同種のハングが実際に発生した既知のリスク)。
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5


def _request_json(req: urllib.request.Request, error_context: str) -> list:
    """timeoutを必ず指定してurlopenし、一時的な失敗(5xx・接続エラー・タイムアウト)は
    指数バックオフで再試行する。4xx等の恒久的エラーは即座に諦める。"""
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if e.code < 500 or attempt == MAX_RETRIES:
                raise RuntimeError(f"{error_context}失敗 ({e.code}): {body}") from e
            last_error = e
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == MAX_RETRIES:
                raise RuntimeError(f"{error_context}失敗 (通信エラー): {e}") from e
            last_error = e
        wait = RETRY_BACKOFF_SECONDS * attempt
        print(
            f"[retry] {error_context}を{wait}秒後に再試行します ({attempt}/{MAX_RETRIES}回目): {last_error}",
            file=sys.stderr,
        )
        time.sleep(wait)
    raise AssertionError("unreachable")

# JRA場コード (JV-Data race_jyo_cd)。この対応表は業界標準でよく知られており確度が高い。
KEIBAJO_NAMES = {
    "01": "札幌", "02": "函館", "03": "福島", "04": "新潟", "05": "東京",
    "06": "中山", "07": "中京", "08": "京都", "09": "阪神", "10": "小倉",
}

# JV-Data性別コード (SE.sex_cd)。標準的な定義。
SEX_NAMES = {"1": "牡", "2": "牝", "3": "セ"}

# JV-Data天候コード (RA.tenko_cd)。要検証。
WEATHER_NAMES = {"1": "晴", "2": "曇", "3": "雨", "4": "小雨", "5": "雪", "6": "小雪"}

# JV-Data馬場状態コード (RA.siba_baba_cd/dirt_baba_cd)。要検証。
BABA_NAMES = {"1": "良", "2": "稍重", "3": "重", "4": "不良"}

# JV-Dataグレードコード (RA.grade_cd)。A/B/Cのみ確度が高い。他は未対応。
GRADE_NAMES = {"A": "G1", "B": "G2", "C": "G3"}

# JV-Data競走条件コード (RA.jyoken_cd1〜5)。公式コード表(JV-Data2311.xls「コード表」シート
# 2007.競走条件コード)より抜粋、701/702/703/999は同シートを実際に開いて確認済み(2026-07-13)。
# 001〜100は収得賞金の上限(万円単位、コード×100万円)を表す純粋な金額区分で、JRAが今どの金額帯を
# 「1勝クラス」等と呼んでいるかは毎年見直されるためJV-Dataのコード自体には含まれない。ここでは
# 金額区分をそのまま表示する(「1勝クラス」等の呼称までは変換しない)。
JYOKEN_CD_SPECIAL_NAMES = {
    "701": "新馬",
    "702": "未出走",
    "703": "未勝利",
    "999": "オープン",
}

# horse_pedigrees(3代血統)の列名。SK(産駒マスタ)の3代血統繁殖登録番号14項目
# (父･母･父父･父母･母父･母母･父父父･父父母･父母父･父母母･母父父･母父母･母母父･母母母)と
# この順序で対応する(parse_records.pyのparse_sk()参照)。
PEDIGREE_COLUMNS = [
    "sire_name", "dam_name", "sire_sire_name", "sire_dam_name", "dam_sire_name", "dam_dam_name",
    "sire_sire_sire_name", "sire_sire_dam_name", "sire_dam_sire_name", "sire_dam_dam_name",
    "dam_sire_sire_name", "dam_sire_dam_name", "dam_dam_sire_name", "dam_dam_dam_name",
]

# HR_parsed.csvの賭式ごとの列プレフィックス -> (race_payouts.bet_type, 件数, 馬番の桁数, 組み合わせの頭数)
# 件数・桁数はparse_records.pyのparse_hr()(JV_HR_PAY構造体準拠)と対応させている。
PAYOUT_GROUPS = {
    "tansho": ("win", 3, 2, 1),
    "fukusho": ("place", 5, 2, 1),
    "wakuren": ("wakuren", 3, 1, 2),
    "umaren": ("umaren", 3, 2, 2),
    "wide": ("wide", 7, 2, 2),
    "umatan": ("umatan", 6, 2, 2),
    "sanrenpuku": ("sanrenpuku", 3, 2, 3),
    "sanrentan": ("sanrentan", 6, 2, 3),
}


def load_env_file(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def guess_track_type(track_cd: str) -> str:
    """要検証: track_cdの数値帯からの推定。境界値はJV-Data仕様書での裏取りが必要。"""
    try:
        n = int(track_cd)
    except (TypeError, ValueError):
        return "芝"
    if n >= 51:
        return "障害"
    if n >= 23:
        return "ダート"
    return "芝"


def parse_time_to_sec(time_str: str) -> "float | None":
    """"1098" -> 1分09秒8 -> 69.8秒。Windows側で実データ検証済みの変換。"""
    if not time_str or not time_str.strip("0"):
        return None
    time_str = time_str.strip()
    if len(time_str) < 4 or not time_str.isdigit():
        return None
    minute = int(time_str[0])
    sec = int(time_str[1:3])
    decisec = int(time_str[3])
    return round(minute * 60 + sec + decisec / 10, 1)


def to_int(value: str) -> "int | None":
    value = (value or "").strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def to_time(value: str) -> "str | None":
    """JV-DataのHHMM形式(4桁、例: '1545')をPostgresのtime型文字列('15:45:00')に変換する。
    未確定時は空白/ゼロ埋めで来るため、数字4桁として解釈できない場合はNoneにする"""
    value = (value or "").strip()
    if len(value) != 4 or not value.isdigit():
        return None
    hour, minute = value[:2], value[2:]
    if not (0 <= int(hour) <= 23 and 0 <= int(minute) <= 59):
        return None
    return f"{hour}:{minute}:00"


def to_float_scaled(value: str, scale: float) -> "float | None":
    value = (value or "").strip()
    if not value:
        return None
    try:
        return round(int(value) / scale, 1)
    except ValueError:
        return None


def guess_race_class(row: dict) -> "str | None":
    """jyoken_cd1〜5からrace_classを組み立てる。

    jyoken_name(自由文字列)は条件戦では空のことが多く判明した(2026-07-13、実データで確認)。
    JV-Dataは条件を自由文字列ではなくコードで持っており、jyoken_cd1〜4がそれぞれ
    2歳条件/3歳条件/4歳条件/5歳以上条件、jyoken_cd5が「最若年条件」(実質的にそのレースの
    主条件)を表す。通常のレースはjyoken_cd5に意味のある値が入るため、まずそちらを見て、
    無ければ1〜4を順に見る(フォーマット仕様書「フォーマット」シートで各スロットの意味を確認済み)。
    """
    for key in ("jyoken_cd5", "jyoken_cd1", "jyoken_cd2", "jyoken_cd3", "jyoken_cd4"):
        code = (row.get(key) or "").strip()
        if not code or code == "000":
            continue
        if code in JYOKEN_CD_SPECIAL_NAMES:
            return JYOKEN_CD_SPECIAL_NAMES[code]
        try:
            return f"収得賞金{int(code) * 100}万円以下"
        except ValueError:
            continue
    return None


def build_jv_race_key(row: dict) -> str:
    return (
        f"{row['race_year']}{row['race_jyo_cd']}{row['race_kaiji']}"
        f"{row['race_nichiji']}{row['race_race_num']}"
    )


def build_race_payload(row: dict) -> dict:
    jyo_cd = row["race_jyo_cd"]
    race_month_day = row["race_month_day"]
    race_name = row.get("hondai") or row.get("ryakusyo10") or row.get("jyoken_name") or ""

    payload = {
        "jv_race_key": build_jv_race_key(row),
        "keibajo_code": jyo_cd,
        "keibajo_name": KEIBAJO_NAMES.get(jyo_cd),
        "kaiji": to_int(row["race_kaiji"]),
        "nichiji": to_int(row["race_nichiji"]),
        "race_number": to_int(row["race_race_num"]),
        "race_date": f"{row['race_year']}-{race_month_day[:2]}-{race_month_day[2:]}",
        "race_name": race_name or None,
        "race_class": row.get("jyoken_name") or guess_race_class(row),
        "track_type": guess_track_type(row.get("track_cd", "")),
        "distance_m": to_int(row.get("kyori", "")),
        "weather": WEATHER_NAMES.get(row.get("tenko_cd", "")),
        "post_time": to_time(row.get("hasso_time", "")),
        # syusso_tosu(出走頭数)はレース確定後にしか埋まらない。未確定レースでも頭数の
        # 目安が使えるよう、無ければtoroku_tosu(登録頭数)にフォールバックする。
        "entry_count": to_int(row.get("syusso_tosu", "")) or to_int(row.get("toroku_tosu", "")),
    }
    if payload["track_type"] == "ダート":
        track_condition = BABA_NAMES.get(row.get("dirt_baba_cd", ""))
    else:
        track_condition = BABA_NAMES.get(row.get("siba_baba_cd", ""))
    payload["track_condition"] = track_condition

    grade_cd = (row.get("grade_cd") or "").strip()
    payload["grade"] = GRADE_NAMES.get(grade_cd)

    # 実測ペース(JV-Link RA由来、2026-08-08追加)。parse_ra()が既に切り出している
    # 前半3ハロン(haron_time_s3)・後半3ハロン=上がり3F(haron_time_l3)・1ハロンごとのラップ25本
    # (lap_time1..25)を races.first_3f_sec/last_3f_sec/lap_times_sec へ載せる。従来は parse 済みなのに
    # ここで捨てていた。トラックバイアス判定が「前有利がスロー起因か本物か」を裏取りするための一次データ。
    # スケールはJV-Dataの1/10秒(例 "342"→34.2秒)。値の無いレース(短距離でハロン数が少ない等)はNone。
    payload["first_3f_sec"] = to_float_scaled(row.get("haron_time_s3", ""), 10)
    payload["last_3f_sec"] = to_float_scaled(row.get("haron_time_l3", ""), 10)
    lap_times = []
    for i in range(1, 26):
        lap = to_float_scaled(row.get(f"lap_time{i}", ""), 10)
        if lap is not None and lap > 0:
            lap_times.append(lap)
    payload["lap_times_sec"] = lap_times or None

    return payload


def build_horse_payload(row: dict) -> dict:
    return {
        "jv_horse_id": row["ketto_num"],
        "horse_name": row["bamei"],
        "sex": SEX_NAMES.get(row.get("sex_cd", "")),
        "trainer_name": row.get("chokyosi_ryakusyo") or None,
        "owner_name": row.get("banusi_name") or None,
    }


def build_entry_payload(row: dict, race_id: str, horse_id: str) -> dict:
    payload = {
        "race_id": race_id,
        "horse_id": horse_id,
        "post_position": to_int(row.get("wakuban", "")),
        "horse_number": to_int(row.get("umaban", "")),
        "jockey_name": row.get("kisyu_ryakusyo") or None,
        # レース時点の管理調教師のスナップショット(horses.trainer_nameは「現在の」管理調教師のみで
        # 乗り替わり履歴を追えないため、race_entries側にも同じSE由来の値を都度保持する。
        # 2026-08-05、trainer_training_baselinesとの突き合わせで列自体が空のまま放置されていたと判明)。
        "trainer_name": row.get("chokyosi_ryakusyo") or None,
        # 斤量は10倍値で格納されている想定 (例: "550" -> 55.0kg)。要検証。
        "jockey_weight_kg": to_float_scaled(row.get("futan", ""), 10),
        "horse_weight_kg": to_int(row.get("ba_taijyu", "")),
        # オッズも10倍値で格納されている想定 (例: "0059" -> 5.9倍)。要検証。
        "odds_win": to_float_scaled(row.get("odds", ""), 10),
        "actual_popularity": to_int(row.get("ninki", "")),
        "finish_position": to_int(row.get("kakutei_jyuni", "")),
        "finish_time_sec": parse_time_to_sec(row.get("time", "")),
    }
    zogen_fugo = (row.get("zogen_fugo") or "").strip()
    zogen_sa = to_int(row.get("zogen_sa", ""))
    if zogen_sa is not None and zogen_fugo in ("+", "-"):
        payload["horse_weight_diff_kg"] = zogen_sa if zogen_fugo == "+" else -zogen_sa
    else:
        payload["horse_weight_diff_kg"] = None

    blinker_flag = (row.get("blinker") or "").strip()
    payload["blinker_raw"] = blinker_flag == "1" if blinker_flag in ("0", "1") else None
    return payload


def compute_blinkers_change(
    blinker_raw: "bool | None",
    prior_blinker_history: list,
    current_race_date: str,
) -> "str | None":
    """今回のblinker_raw(bool|None)と、同じ馬の過去のrace_entries行から集めた
    [(race_date, blinker_raw), ...](昇順ソート済み)を比較し、blinkers_changeを導出する。
    race_entries.blinkers_changeのCHECK制約が'新規'/'継続'/'解除'のみを許容するため、
    「前走情報が無い」「両走ともブリンカー無し」の場合はNoneを返す
    (制約上「継続(未使用)」に相当する4つ目の値は存在しない)。"""
    if blinker_raw is None:
        return None
    prior_flag = None
    for race_date, flag in reversed(prior_blinker_history):
        if race_date < current_race_date:
            prior_flag = flag
            break
    if prior_flag is None:
        return None
    if prior_flag == blinker_raw:
        return "継続" if blinker_raw else None
    return "新規" if blinker_raw else "解除"


def build_training_session_payload(row: dict, horse_id: str, trainer_name: "str | None") -> "dict | None":
    """HC_parsed.csv(parse_slop出力)の1行からtraining_sessionsのpayloadを組み立てる。
    区間タイムはnetkeiba公表値(ロードトレイル、2026-07-29)との実データ突き合わせでバイト位置を
    確定済み(scripts/jvlink/parse_records.pyのparse_slop docstring参照)。lap_times_secは
    「ゴール手前メートル数」をキーにしたラップタイム、total_time_secは800m地点までの累計
    (=坂路の総合タイム)。facilityはtc_rawの意味が実データと不一致で確定できないため未設定のまま。"""
    year, month, day = row.get("training_year", ""), row.get("training_month", ""), row.get("training_day", "")
    if not (year.isdigit() and month.isdigit() and day.isdigit()):
        return None
    hour, minute = row.get("training_hour", ""), row.get("training_minute", "")
    training_time = f"{hour}:{minute}:00" if hour.isdigit() and minute.isdigit() else None

    lap_times_sec = {}
    total_time_sec = None
    cum_800 = to_float_scaled(row.get("cum_800", ""), 10)
    lap_800_600 = to_float_scaled(row.get("lap_800_600", ""), 10)
    lap_600_400 = to_float_scaled(row.get("lap_600_400", ""), 10)
    lap_400_200 = to_float_scaled(row.get("lap_400_200", ""), 10)
    cum_200 = to_float_scaled(row.get("cum_200", ""), 10)
    if cum_800 is not None:
        total_time_sec = cum_800
    if lap_800_600 is not None:
        lap_times_sec["800"] = lap_800_600
    if lap_600_400 is not None:
        lap_times_sec["600"] = lap_600_400
    if lap_400_200 is not None:
        lap_times_sec["400"] = lap_400_200
    if cum_200 is not None:
        lap_times_sec["200"] = cum_200

    return {
        "horse_id": horse_id,
        "trainer_name": trainer_name,  # 調教時点の管理調教師スナップショット(厩舎単位の集計用)
        "training_date": f"{year}-{month}-{day}",
        "training_time": training_time,
        "training_type": "坂路",
        "facility": None,  # tc_rawの意味が実データと不一致で確定できないため未設定(parse_slop docstring参照)
        "lap_times_sec": lap_times_sec,
        "total_time_sec": total_time_sec,
        "data_source": "jv_link",
    }


def build_odds_updates(row: dict) -> list:
    """O1_parsed.csvの1行(1レース分、単勝オッズは最大28頭分がフラット化されている)から、
    race_entries.odds_win / expected_popularity を更新するための(horse_number, odds_win,
    expected_popularity)のリストを組み立てる。odds_winは10倍値と仮定して/10する
    (SE由来のodds_winと同じスケール変換、scripts/jvlink/README.md参照)。"""
    updates = []
    for i in range(1, 29):
        umaban = to_int(row.get(f"tansho_umaban{i}", ""))
        if not umaban:
            continue
        odds_win = to_float_scaled(row.get(f"tansho_odds{i}", ""), 10)
        expected_popularity = to_int(row.get(f"tansho_ninki{i}", ""))
        if odds_win is None and expected_popularity is None:
            continue
        updates.append(
            {
                "horse_number": umaban,
                "odds_win": odds_win,
                "expected_popularity": expected_popularity,
            }
        )
    return updates


def _format_combination(raw: str, num_width: int, num_parts: int) -> "str | None":
    raw = (raw or "").strip()
    if len(raw) != num_width * num_parts:
        return None
    numbers = [raw[i : i + num_width] for i in range(0, len(raw), num_width)]
    if not all(n.strip() for n in numbers):
        return None
    return "-".join(str(int(n)) for n in numbers)


def build_payout_payloads(row: dict, race_id: str) -> list:
    payloads = []
    for prefix, (bet_type, count, num_width, num_parts) in PAYOUT_GROUPS.items():
        for i in range(1, count + 1):
            combination = _format_combination(
                row.get(f"{prefix}_combination{i}", ""), num_width, num_parts
            )
            payout_yen = to_int(row.get(f"{prefix}_payout_yen{i}", ""))
            if combination is None or payout_yen is None:
                continue
            payloads.append(
                {
                    "race_id": race_id,
                    "bet_type": bet_type,
                    "combination": combination,
                    "payout_yen": payout_yen,
                    "popularity": to_int(row.get(f"{prefix}_ninki{i}", "")),
                    "data_source": "jv_link",
                }
            )
    return payloads


def build_combo_odds_payloads(
    row: dict, race_id: str, prefix: str, bet_type: str, count: int, has_range: bool
) -> list:
    """O2_parsed.csv(馬連)/O3_parsed.csv(ワイド)の1行から、race_odds_combinationsへの
    upsert用payloadを組み立てる。オッズは10倍値で格納されている(O1のtansho_oddsと同じ
    スケール、scripts/jvlink/parse_records.pyのparse_o2/parse_o3参照)。
    馬連(has_range=False)はoddsのみ、ワイド(has_range=True)はodds_low/odds_highを使う。
    """
    payloads = []
    for i in range(1, count + 1):
        combination = _format_combination(row.get(f"{prefix}_kumiban{i}", ""), 2, 2)
        if combination is None:
            continue
        payload = {
            "race_id": race_id,
            "bet_type": bet_type,
            "combination": combination,
            "popularity": to_int(row.get(f"{prefix}_ninki{i}", "")),
            "data_source": "jv_link",
        }
        if has_range:
            odds_low = to_float_scaled(row.get(f"{prefix}_odds_low{i}", ""), 10)
            odds_high = to_float_scaled(row.get(f"{prefix}_odds_high{i}", ""), 10)
            if odds_low is None and odds_high is None:
                continue
            payload["odds_low"] = odds_low
            payload["odds_high"] = odds_high
        else:
            odds = to_float_scaled(row.get(f"{prefix}_odds{i}", ""), 10)
            if odds is None:
                continue
            payload["odds"] = odds
        payloads.append(payload)
    return payloads


def dedupe_by_key(payloads: list, key_fn) -> list:
    """同じconflictキーが1バッチ内に複数あるとPostgRESTのON CONFLICTがエラーになるため、
    最後に出現したものを採用して重複を除く(JV-Dataは同じレースを複数回送ってくることがある)。"""
    deduped = {}
    for p in payloads:
        deduped[key_fn(p)] = p
    return list(deduped.values())


class SupabaseClient:
    def __init__(self, url: str, service_role_key: str):
        self.base_url = url.rstrip("/") + "/rest/v1"
        self.key = service_role_key

    def select(self, table: str, params: dict) -> list:
        query = urllib.parse.urlencode(params)
        req = urllib.request.Request(
            f"{self.base_url}/{table}?{query}",
            headers={"apikey": self.key, "Authorization": f"Bearer {self.key}"},
        )
        return _request_json(req, f"{table}への問い合わせ")

    def update(self, table: str, filters: dict, body: dict) -> list:
        """race_entriesのように、既存行の一部カラムだけをrace_id+horse_number等の条件で
        更新したい場合に使う(upsertと違い、未指定カラムに触れず該当行が無ければ何もしない)。"""
        query = urllib.parse.urlencode(filters)
        req = urllib.request.Request(
            f"{self.base_url}/{table}?{query}",
            data=json.dumps(body).encode("utf-8"),
            method="PATCH",
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
        )
        return _request_json(req, f"{table}への更新")

    def upsert(self, table: str, rows: list, on_conflict: str) -> list:
        if not rows:
            return []
        results = []
        batch_size = 500
        for i in range(0, len(rows), batch_size):
            batch = rows[i : i + batch_size]
            req = urllib.request.Request(
                f"{self.base_url}/{table}?on_conflict={on_conflict}",
                data=json.dumps(batch).encode("utf-8"),
                method="POST",
                headers={
                    "apikey": self.key,
                    "Authorization": f"Bearer {self.key}",
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates,return=representation",
                },
            )
            results.extend(_request_json(req, f"{table}へのupsert"))
        return results


def main() -> None:
    parser = argparse.ArgumentParser(description="RA/SE CSVをSupabaseへupsertする")
    parser.add_argument("ra_csv", help="RA_parsed.csvのパス")
    parser.add_argument("se_csv", help="SE_parsed.csvのパス")
    parser.add_argument("--env-file", help=".env.local等のパス (指定時は環境変数より優先しない)")
    parser.add_argument("--hr-csv", help="HR_parsed.csv(払戻情報)のパス。指定時はrace_payoutsへupsertする")
    parser.add_argument(
        "--o1-csv",
        help="O1_parsed.csv(単勝・複勝・枠連オッズ、JVRTOpen由来)のパス。"
        "指定時はrace_entries.odds_win/expected_popularityを更新する",
    )
    parser.add_argument(
        "--o2-csv",
        help="O2_parsed.csv(馬連オッズ、JVRTOpen \"0B30\"由来)のパス。"
        "指定時はrace_odds_combinationsへupsertする",
    )
    parser.add_argument(
        "--o3-csv",
        help="O3_parsed.csv(ワイドオッズ、JVRTOpen \"0B30\"由来)のパス。"
        "指定時はrace_odds_combinationsへupsertする",
    )
    parser.add_argument(
        "--hn-csv",
        help="HN_parsed.csv(繁殖馬マスタ)のパス。--sk-csvと併用時のみ使う"
        "(繁殖登録番号から馬名を引くルックアップ用)",
    )
    parser.add_argument(
        "--sk-csv",
        help="SK_parsed.csv(産駒マスタ、3代血統)のパス。指定時はhorse_pedigreesへupsertする"
        "(--hn-csvも必須)",
    )
    parser.add_argument(
        "--hc-csv",
        help="HC_parsed.csv(坂路調教情報)のパス。指定時はtraining_sessionsへupsertする。"
        "調教年月日時刻・血統登録番号のみ書き込む(区間タイムはバイト位置未確定のため"
        "2026-08-05時点では書き込まない、scripts/jvlink/parse_records.pyのparse_slop参照)",
    )
    args = parser.parse_args()

    if args.env_file:
        load_env_file(args.env_file)

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print(
            "環境変数 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。"
            " --env-file .env.local のように指定するか、事前にexportしてください。",
            file=sys.stderr,
        )
        sys.exit(1)

    client = SupabaseClient(supabase_url, service_key)

    with open(args.ra_csv, encoding="utf-8") as f:
        ra_rows = list(csv.DictReader(f))
    with open(args.se_csv, encoding="utf-8") as f:
        se_rows = list(csv.DictReader(f))

    print(f"[読み込み] RA={len(ra_rows)}件 SE={len(se_rows)}件", file=sys.stderr)

    race_payloads = dedupe_by_key(
        [build_race_payload(r) for r in ra_rows], lambda p: p["jv_race_key"]
    )
    race_results = client.upsert("races", race_payloads, on_conflict="jv_race_key")
    race_id_by_key = {r["jv_race_key"]: r["id"] for r in race_results}
    # blinkers_change算出(前走比較)用に、今回upsertした各レースのrace_dateも保持しておく。
    race_date_by_id = {r["id"]: r["race_date"] for r in race_results}
    print(f"[races] {len(race_results)}件 upsert完了", file=sys.stderr)

    # 同じ馬が複数レースに出走する場合があるため、ketto_num単位で重複排除してからupsert
    horse_payloads_by_id = {}
    for row in se_rows:
        payload = build_horse_payload(row)
        horse_payloads_by_id[payload["jv_horse_id"]] = payload
    horse_results = client.upsert(
        "horses", list(horse_payloads_by_id.values()), on_conflict="jv_horse_id"
    )
    horse_id_by_jv_id = {h["jv_horse_id"]: h["id"] for h in horse_results}
    print(f"[horses] {len(horse_results)}件 upsert完了", file=sys.stderr)

    entry_payloads = []
    skipped = 0
    for row in se_rows:
        race_key = build_jv_race_key(row)
        race_id = race_id_by_key.get(race_key)
        horse_id = horse_id_by_jv_id.get(row["ketto_num"])
        if not race_id or not horse_id:
            skipped += 1
            continue
        payload = build_entry_payload(row, race_id, horse_id)
        if not payload["horse_number"]:
            # 出馬表確定前(JV-Dataのdata_kubun=1、umaban未採番="00")のプレースホルダー行。
            # (race_id, horse_number)がupsertのON CONFLICTキーのため、これを素通しすると
            # 同じレースの全馬が同じキー(horse_number=0)に潰れ合い、最後の1頭しか残らなくなる
            # (実際に2026-07-11、枠順未確定だった7/12開催の全レースでこの事故が発生した)。
            # horse_number=0は実在しない馬番のため、race_entriesには入れずスキップする。
            skipped += 1
            continue
        entry_payloads.append(payload)

    entry_payloads = dedupe_by_key(
        entry_payloads, lambda p: (p["race_id"], p["horse_number"])
    )

    # blinkers_change(新規/継続/解除)は前走のblinker_rawとの比較でしか出せないため、
    # 対象馬の既存race_entries(このバッチでこれからupsertする分より前の、既にDBにある行)を
    # horse_id単位でまとめて取得し、race_id -> race_dateで日付順に並べ替えてから比較する。
    blinker_target_horse_ids = sorted(
        {p["horse_id"] for p in entry_payloads if p.get("blinker_raw") is not None}
    )
    blinker_history_by_horse: dict = {hid: [] for hid in blinker_target_horse_ids}
    if blinker_target_horse_ids:
        chunk_size = 100
        prior_entries = []
        for i in range(0, len(blinker_target_horse_ids), chunk_size):
            chunk = blinker_target_horse_ids[i : i + chunk_size]
            prior_entries.extend(
                client.select(
                    "race_entries",
                    {
                        "horse_id": f"in.({','.join(chunk)})",
                        "blinker_raw": "not.is.null",
                        "select": "horse_id,race_id,blinker_raw",
                    },
                )
            )
        prior_race_ids = sorted({e["race_id"] for e in prior_entries} - race_date_by_id.keys())
        if prior_race_ids:
            chunk_size = 100
            for i in range(0, len(prior_race_ids), chunk_size):
                chunk = prior_race_ids[i : i + chunk_size]
                for r in client.select(
                    "races", {"id": f"in.({','.join(chunk)})", "select": "id,race_date"}
                ):
                    race_date_by_id[r["id"]] = r["race_date"]
        for e in prior_entries:
            race_date = race_date_by_id.get(e["race_id"])
            if race_date:
                blinker_history_by_horse[e["horse_id"]].append((race_date, e["blinker_raw"]))
        for history in blinker_history_by_horse.values():
            history.sort(key=lambda t: t[0])

    for payload in entry_payloads:
        current_race_date = race_date_by_id.get(payload["race_id"])
        if current_race_date is None:
            continue
        payload["blinkers_change"] = compute_blinkers_change(
            payload.get("blinker_raw"),
            blinker_history_by_horse.get(payload["horse_id"], []),
            current_race_date,
        )

    entry_results = client.upsert(
        "race_entries", entry_payloads, on_conflict="race_id,horse_number"
    )
    blinkers_change_count = sum(1 for p in entry_payloads if p.get("blinkers_change"))
    print(
        f"[race_entries] {len(entry_results)}件 upsert完了 (skipped={skipped}, "
        f"blinkers_change設定={blinkers_change_count})",
        file=sys.stderr,
    )

    if args.hr_csv:
        if not os.path.exists(args.hr_csv):
            print(f"[race_payouts] {args.hr_csv} が見つからないためスキップ", file=sys.stderr)
        else:
            with open(args.hr_csv, encoding="utf-8") as f:
                hr_rows = list(csv.DictReader(f))
            print(f"[読み込み] HR={len(hr_rows)}件", file=sys.stderr)

            # 今回のraces upsertで解決できなかったキーは、jv_race_keyで問い合わせて補完する
            # (HR_parsed.csv単体で走らせるケースにも対応するため)
            missing_keys = {
                build_jv_race_key(r) for r in hr_rows
            } - race_id_by_key.keys()
            if missing_keys:
                lookup = client.select(
                    "races",
                    {
                        "jv_race_key": f"in.({','.join(sorted(missing_keys))})",
                        "select": "id,jv_race_key",
                    },
                )
                for r in lookup:
                    race_id_by_key[r["jv_race_key"]] = r["id"]

            payout_payloads = []
            payout_skipped = 0
            for row in hr_rows:
                race_id = race_id_by_key.get(build_jv_race_key(row))
                if not race_id:
                    payout_skipped += 1
                    continue
                payout_payloads.extend(build_payout_payloads(row, race_id))

            payout_payloads = dedupe_by_key(
                payout_payloads, lambda p: (p["race_id"], p["bet_type"], p["combination"])
            )
            payout_results = client.upsert(
                "race_payouts", payout_payloads, on_conflict="race_id,bet_type,combination"
            )
            print(
                f"[race_payouts] {len(payout_results)}件 upsert完了 (skipped={payout_skipped})",
                file=sys.stderr,
            )

    if args.o1_csv:
        if not os.path.exists(args.o1_csv):
            print(f"[race_entries odds] {args.o1_csv} が見つからないためスキップ", file=sys.stderr)
        else:
            with open(args.o1_csv, encoding="utf-8") as f:
                o1_rows = list(csv.DictReader(f))
            print(f"[読み込み] O1={len(o1_rows)}件", file=sys.stderr)

            missing_keys = {
                build_jv_race_key(r) for r in o1_rows
            } - race_id_by_key.keys()
            if missing_keys:
                lookup = client.select(
                    "races",
                    {
                        "jv_race_key": f"in.({','.join(sorted(missing_keys))})",
                        "select": "id,jv_race_key",
                    },
                )
                for r in lookup:
                    race_id_by_key[r["jv_race_key"]] = r["id"]

            odds_updated = 0
            odds_skipped_no_race = 0
            for row in o1_rows:
                race_id = race_id_by_key.get(build_jv_race_key(row))
                if not race_id:
                    odds_skipped_no_race += 1
                    continue
                for update in build_odds_updates(row):
                    horse_number = update.pop("horse_number")
                    client.update(
                        "race_entries",
                        {"race_id": f"eq.{race_id}", "horse_number": f"eq.{horse_number}"},
                        update,
                    )
                    odds_updated += 1

            print(
                f"[race_entries odds] {odds_updated}頭分 更新完了 (race未特定でスキップ={odds_skipped_no_race})",
                file=sys.stderr,
            )

    for csv_path, prefix, bet_type, count, has_range in (
        (args.o2_csv, "umaren", "umaren", 153, False),
        (args.o3_csv, "wide", "wide", 153, True),
    ):
        if not csv_path:
            continue
        if not os.path.exists(csv_path):
            print(f"[race_odds_combinations] {csv_path} が見つからないためスキップ", file=sys.stderr)
            continue

        with open(csv_path, encoding="utf-8") as f:
            combo_rows = list(csv.DictReader(f))
        print(f"[読み込み] {prefix.upper()}={len(combo_rows)}件", file=sys.stderr)

        missing_keys = {build_jv_race_key(r) for r in combo_rows} - race_id_by_key.keys()
        if missing_keys:
            lookup = client.select(
                "races",
                {
                    "jv_race_key": f"in.({','.join(sorted(missing_keys))})",
                    "select": "id,jv_race_key",
                },
            )
            for r in lookup:
                race_id_by_key[r["jv_race_key"]] = r["id"]

        combo_payloads = []
        combo_skipped = 0
        for row in combo_rows:
            race_id = race_id_by_key.get(build_jv_race_key(row))
            if not race_id:
                combo_skipped += 1
                continue
            combo_payloads.extend(
                build_combo_odds_payloads(row, race_id, prefix, bet_type, count, has_range)
            )

        combo_payloads = dedupe_by_key(
            combo_payloads, lambda p: (p["race_id"], p["bet_type"], p["combination"])
        )
        combo_results = client.upsert(
            "race_odds_combinations", combo_payloads, on_conflict="race_id,bet_type,combination"
        )
        print(
            f"[race_odds_combinations/{bet_type}] {len(combo_results)}件 upsert完了 "
            f"(race未特定でスキップ={combo_skipped})",
            file=sys.stderr,
        )

    if args.hn_csv and args.sk_csv:
        if not os.path.exists(args.hn_csv) or not os.path.exists(args.sk_csv):
            print(
                f"[horse_pedigrees] {args.hn_csv} または {args.sk_csv} が見つからないためスキップ",
                file=sys.stderr,
            )
        else:
            with open(args.hn_csv, encoding="utf-8") as f:
                hn_rows = list(csv.DictReader(f))
            with open(args.sk_csv, encoding="utf-8") as f:
                sk_rows = list(csv.DictReader(f))
            print(f"[読み込み] HN={len(hn_rows)}件 SK={len(sk_rows)}件", file=sys.stderr)

            # 繁殖登録番号 -> 馬名(SKの14項目はいずれも繁殖登録番号のままなので、
            # このルックアップで馬名に変換してhorse_pedigreesの*_name列へ入れる)
            name_by_hanshoku_num = {
                r["hanshoku_toroku_num"]: r["bamei"]
                for r in hn_rows
                if (r.get("hanshoku_toroku_num") or "").strip()
            }

            # SK対象馬(血統登録番号=horses.jv_horse_id)のhorse_idをSupabaseから解決する。
            # SK.txtの対象は今回のBLOD差分更新分であり、今回のSE(出走馬)と必ずしも
            # 一致しないため、既存のhorse_id_by_jv_idに無ければ都度問い合わせる。
            jv_ids_needed = sorted(
                {r["ketto_num"] for r in sk_rows if (r.get("ketto_num") or "").strip()}
                - horse_id_by_jv_id.keys()
            )
            if jv_ids_needed:
                chunk_size = 100
                for i in range(0, len(jv_ids_needed), chunk_size):
                    chunk = jv_ids_needed[i : i + chunk_size]
                    lookup = client.select(
                        "horses",
                        {"jv_horse_id": f"in.({','.join(chunk)})", "select": "id,jv_horse_id"},
                    )
                    for h in lookup:
                        horse_id_by_jv_id[h["jv_horse_id"]] = h["id"]

            pedigree_payloads = []
            pedigree_skipped_no_horse = 0
            for row in sk_rows:
                horse_id = horse_id_by_jv_id.get(row.get("ketto_num"))
                if not horse_id:
                    # このアプリのhorsesにまだ登録されていない馬(race_entriesに未出走)は
                    # 対象外。出走時にhorsesへ登録された後、次回のBLOD差分同期で拾われる。
                    pedigree_skipped_no_horse += 1
                    continue
                payload = {"horse_id": horse_id, "data_source": "jv_link"}
                for i, col in enumerate(PEDIGREE_COLUMNS, start=1):
                    num = (row.get(f"hanshoku_toroku_num{i}") or "").strip()
                    payload[col] = name_by_hanshoku_num.get(num)
                pedigree_payloads.append(payload)

            pedigree_payloads = dedupe_by_key(pedigree_payloads, lambda p: p["horse_id"])
            pedigree_results = client.upsert(
                "horse_pedigrees", pedigree_payloads, on_conflict="horse_id"
            )
            print(
                f"[horse_pedigrees] {len(pedigree_results)}件 upsert完了 "
                f"(対象馬未登録でスキップ={pedigree_skipped_no_horse})",
                file=sys.stderr,
            )

    if args.hc_csv:
        if not os.path.exists(args.hc_csv):
            print(f"[training_sessions] {args.hc_csv} が見つからないためスキップ", file=sys.stderr)
        else:
            with open(args.hc_csv, encoding="utf-8") as f:
                hc_rows = list(csv.DictReader(f))
            print(f"[読み込み] HC={len(hc_rows)}件", file=sys.stderr)

            # trainer_name(調教時点の管理調教師スナップショット)は今回のSEバッチに含まれる馬なら
            # horse_payloads_by_idから、そうでなければ以下のフォールバック問い合わせから解決する。
            trainer_name_by_jv_id = {
                jv_id: payload.get("trainer_name") for jv_id, payload in horse_payloads_by_id.items()
            }

            jv_ids_needed = sorted(
                {r["ketto_num"] for r in hc_rows if (r.get("ketto_num") or "").strip()}
                - horse_id_by_jv_id.keys()
            )
            if jv_ids_needed:
                chunk_size = 100
                for i in range(0, len(jv_ids_needed), chunk_size):
                    chunk = jv_ids_needed[i : i + chunk_size]
                    lookup = client.select(
                        "horses",
                        {"jv_horse_id": f"in.({','.join(chunk)})", "select": "id,jv_horse_id,trainer_name"},
                    )
                    for h in lookup:
                        horse_id_by_jv_id[h["jv_horse_id"]] = h["id"]
                        trainer_name_by_jv_id[h["jv_horse_id"]] = h.get("trainer_name")

            training_payloads = []
            training_skipped_no_horse = 0
            training_skipped_bad_data = 0
            for row in hc_rows:
                ketto_num = row.get("ketto_num")
                horse_id = horse_id_by_jv_id.get(ketto_num)
                if not horse_id:
                    # このアプリのhorsesにまだ登録されていない馬(race_entriesに未出走)は対象外
                    # (horse_pedigreesと同じ方針。出走後にhorsesへ登録されれば次回以降拾われる)。
                    training_skipped_no_horse += 1
                    continue
                payload = build_training_session_payload(row, horse_id, trainer_name_by_jv_id.get(ketto_num))
                if payload is None:
                    training_skipped_bad_data += 1
                    continue
                training_payloads.append(payload)

            training_payloads = dedupe_by_key(
                training_payloads,
                lambda p: (p["horse_id"], p["training_date"], p["training_time"], p["training_type"]),
            )
            training_results = client.upsert(
                "training_sessions",
                training_payloads,
                on_conflict="horse_id,training_date,training_time,training_type",
            )
            print(
                f"[training_sessions] {len(training_results)}件 upsert完了 "
                f"(対象馬未登録でスキップ={training_skipped_no_horse}, "
                f"日時不正でスキップ={training_skipped_bad_data})",
                file=sys.stderr,
            )


if __name__ == "__main__":
    main()
