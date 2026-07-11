"""
fetch_raw.py が保存した RA.txt / SE.txt (cp932固定長の生レコード) を
項目ごとに分解してCSVに変換する。

バイトオフセットは JRA-VAN 公式配布の JVData_Struct.cs (JV_RA_RACE / JV_SE_RACE_UMA)
の SetDataB実装に完全準拠している(全項目のバイト位置をそちらの実装と突き合わせ済み)。

使い方:
    py -3.12-32 parse_records.py <indir> <outdir>
例:
    py -3.12-32 parse_records.py out out
"""

import csv
import os
import sys


class ByteCursor:
    """cp932でエンコードされたバイト列を、公式仕様のバイト位置通りに順番に切り出す。

    JV-Dataの項目は全角文字を含むため、Pythonのstr(文字単位)でスライスすると
    バイト位置とずれる。必ずエンコード済みのbytesに対してスライスしてから
    cp932でデコードする(JVData_Struct.csのMidB2Sと同じ考え方)。
    """

    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def take(self, length: int) -> str:
        chunk = self.data[self.pos:self.pos + length]
        self.pos += length
        return chunk.decode("cp932", errors="replace").strip()


def _flatten_list(d, prefix, items):
    for i, v in enumerate(items, start=1):
        d[f"{prefix}{i}"] = v


def parse_record_id(c: ByteCursor, d: dict):
    d["record_spec"] = c.take(2)
    d["data_kubun"] = c.take(1)
    d["make_date"] = c.take(8)  # YYYYMMDD


def parse_race_id(c: ByteCursor, d: dict, prefix="race_"):
    d[f"{prefix}year"] = c.take(4)
    d[f"{prefix}month_day"] = c.take(4)
    d[f"{prefix}jyo_cd"] = c.take(2)
    d[f"{prefix}kaiji"] = c.take(2)
    d[f"{prefix}nichiji"] = c.take(2)
    d[f"{prefix}race_num"] = c.take(2)


def parse_race_info(c: ByteCursor, d: dict):
    d["youbi_cd"] = c.take(1)
    d["toku_num"] = c.take(4)
    d["hondai"] = c.take(60)
    d["fukudai"] = c.take(60)
    d["kakko"] = c.take(60)
    d["hondai_eng"] = c.take(120)
    d["fukudai_eng"] = c.take(120)
    d["kakko_eng"] = c.take(120)
    d["ryakusyo10"] = c.take(20)
    d["ryakusyo6"] = c.take(12)
    d["ryakusyo3"] = c.take(6)
    d["kubun"] = c.take(1)
    d["nkai"] = c.take(3)


def parse_race_jyoken(c: ByteCursor, d: dict):
    d["syubetu_cd"] = c.take(2)
    d["kigo_cd"] = c.take(3)
    d["jyuryo_cd"] = c.take(1)
    _flatten_list(d, "jyoken_cd", [c.take(3) for _ in range(5)])


def parse_tenko_baba(c: ByteCursor, d: dict):
    d["tenko_cd"] = c.take(1)
    d["siba_baba_cd"] = c.take(1)
    d["dirt_baba_cd"] = c.take(1)


def parse_corner_info(c: ByteCursor) -> dict:
    return {
        "corner": c.take(1),
        "syukaisu": c.take(1),
        "jyuni": c.take(70),
    }


def parse_chakuuma_info(c: ByteCursor) -> dict:
    return {
        "ketto_num": c.take(10),
        "bamei": c.take(36),
    }


def parse_ra(data: bytes) -> dict:
    c = ByteCursor(data)
    d = {}
    parse_record_id(c, d)
    parse_race_id(c, d)
    parse_race_info(c, d)
    d["grade_cd"] = c.take(1)
    d["grade_cd_before"] = c.take(1)
    parse_race_jyoken(c, d)
    d["jyoken_name"] = c.take(60)
    d["kyori"] = c.take(4)
    d["kyori_before"] = c.take(4)
    d["track_cd"] = c.take(2)
    d["track_cd_before"] = c.take(2)
    d["course_kubun_cd"] = c.take(2)
    d["course_kubun_cd_before"] = c.take(2)
    _flatten_list(d, "honsyokin", [c.take(8) for _ in range(7)])
    _flatten_list(d, "honsyokin_before", [c.take(8) for _ in range(5)])
    _flatten_list(d, "fukasyokin", [c.take(8) for _ in range(5)])
    _flatten_list(d, "fukasyokin_before", [c.take(8) for _ in range(3)])
    d["hasso_time"] = c.take(4)
    d["hasso_time_before"] = c.take(4)
    d["toroku_tosu"] = c.take(2)
    d["syusso_tosu"] = c.take(2)
    d["nyusen_tosu"] = c.take(2)
    parse_tenko_baba(c, d)
    _flatten_list(d, "lap_time", [c.take(3) for _ in range(25)])
    d["syogai_mile_time"] = c.take(4)
    d["haron_time_s3"] = c.take(3)
    d["haron_time_s4"] = c.take(3)
    d["haron_time_l3"] = c.take(3)
    d["haron_time_l4"] = c.take(3)
    for i in range(1, 5):
        corner = parse_corner_info(c)
        for k, v in corner.items():
            d[f"corner{i}_{k}"] = v
    d["record_up_kubun"] = c.take(1)
    return d


def parse_se(data: bytes) -> dict:
    c = ByteCursor(data)
    d = {}
    parse_record_id(c, d)
    parse_race_id(c, d)
    d["wakuban"] = c.take(1)
    d["umaban"] = c.take(2)
    d["ketto_num"] = c.take(10)
    d["bamei"] = c.take(36)
    d["uma_kigo_cd"] = c.take(2)
    d["sex_cd"] = c.take(1)
    d["hinsyu_cd"] = c.take(1)
    d["keiro_cd"] = c.take(2)
    d["barei"] = c.take(2)
    d["tozai_cd"] = c.take(1)
    d["chokyosi_code"] = c.take(5)
    d["chokyosi_ryakusyo"] = c.take(8)
    d["banusi_code"] = c.take(6)
    d["banusi_name"] = c.take(64)
    d["fukusyoku"] = c.take(60)
    c.take(60)  # reserved1
    d["futan"] = c.take(3)
    d["futan_before"] = c.take(3)
    d["blinker"] = c.take(1)
    c.take(1)  # reserved2
    d["kisyu_code"] = c.take(5)
    d["kisyu_code_before"] = c.take(5)
    d["kisyu_ryakusyo"] = c.take(8)
    d["kisyu_ryakusyo_before"] = c.take(8)
    d["minarai_cd"] = c.take(1)
    d["minarai_cd_before"] = c.take(1)
    d["ba_taijyu"] = c.take(3)
    d["zogen_fugo"] = c.take(1)
    d["zogen_sa"] = c.take(3)
    d["ijyo_cd"] = c.take(1)
    d["nyusen_jyuni"] = c.take(2)
    d["kakutei_jyuni"] = c.take(2)  # 着順
    d["dochaku_kubun"] = c.take(1)
    d["dochaku_tosu"] = c.take(1)
    d["time"] = c.take(4)  # 走破タイム
    d["chakusa_cd"] = c.take(3)
    d["chakusa_cd_p"] = c.take(3)
    d["chakusa_cd_pp"] = c.take(3)
    d["jyuni_1c"] = c.take(2)
    d["jyuni_2c"] = c.take(2)
    d["jyuni_3c"] = c.take(2)
    d["jyuni_4c"] = c.take(2)
    d["odds"] = c.take(4)
    d["ninki"] = c.take(2)
    d["honsyokin"] = c.take(8)
    d["fukasyokin"] = c.take(8)
    c.take(3)  # reserved3
    c.take(3)  # reserved4
    d["haron_time_l4"] = c.take(3)
    d["haron_time_l3"] = c.take(3)
    for i in range(1, 4):
        chakuuma = parse_chakuuma_info(c)
        for k, v in chakuuma.items():
            d[f"chakuuma{i}_{k}"] = v
    d["time_diff"] = c.take(4)
    d["record_up_kubun"] = c.take(1)
    d["dm_kubun"] = c.take(1)
    d["dm_time"] = c.take(5)
    d["dm_gosa_p"] = c.take(4)
    d["dm_gosa_m"] = c.take(4)
    d["dm_jyuni"] = c.take(2)
    d["kyakusitu_kubun"] = c.take(1)
    return d


def parse_jg(data: bytes) -> dict:
    c = ByteCursor(data)
    d = {}
    parse_record_id(c, d)
    parse_race_id(c, d)
    d["ketto_num"] = c.take(10)
    d["bamei"] = c.take(36)
    d["shutsuba_touhyo_jun"] = c.take(3)
    d["syusso_kubun"] = c.take(1)
    d["jogai_jotai_kubun"] = c.take(1)  # 除外状態区分
    return d


def _parse_pay_group(c: ByteCursor, count: int, combo_len: int, ninki_len: int):
    """PAY_INFO1〜4共通の(組番/馬番, 払戻金9桁, 人気順)の繰り返し項目を切り出す。"""
    combinations, payouts, ninkis = [], [], []
    for _ in range(count):
        combinations.append(c.take(combo_len))
        payouts.append(c.take(9))
        ninkis.append(c.take(ninki_len))
    return combinations, payouts, ninkis


def _add_pay_group(d: dict, prefix: str, c: ByteCursor, count: int, combo_len: int, ninki_len: int):
    combinations, payouts, ninkis = _parse_pay_group(c, count, combo_len, ninki_len)
    _flatten_list(d, f"{prefix}_combination", combinations)
    _flatten_list(d, f"{prefix}_payout_yen", payouts)
    _flatten_list(d, f"{prefix}_ninki", ninkis)


def parse_hr(data: bytes) -> dict:
    """JV_HR_PAY(払戻情報)。組番/馬番・払戻金(円)・人気順を賭式ごとにフラット化して格納する。"""
    c = ByteCursor(data)
    d = {}
    parse_record_id(c, d)
    parse_race_id(c, d)
    d["toroku_tosu"] = c.take(2)
    d["syusso_tosu"] = c.take(2)
    _flatten_list(d, "fuseiritu_flag", [c.take(1) for _ in range(9)])
    _flatten_list(d, "tokubarai_flag", [c.take(1) for _ in range(9)])
    _flatten_list(d, "henkan_flag", [c.take(1) for _ in range(9)])
    _flatten_list(d, "henkan_uma", [c.take(1) for _ in range(28)])
    _flatten_list(d, "henkan_waku", [c.take(1) for _ in range(8)])
    _flatten_list(d, "henkan_do_waku", [c.take(1) for _ in range(8)])

    _add_pay_group(d, "tansho", c, 3, 2, 2)      # 単勝
    _add_pay_group(d, "fukusho", c, 5, 2, 2)     # 複勝
    _add_pay_group(d, "wakuren", c, 3, 2, 2)     # 枠連
    _add_pay_group(d, "umaren", c, 3, 4, 3)      # 馬連
    _add_pay_group(d, "wide", c, 7, 4, 3)        # ワイド
    _parse_pay_group(c, 3, 4, 3)                 # 予備(未使用、バイト位置合わせのため読み捨て)
    _add_pay_group(d, "umatan", c, 6, 4, 3)      # 馬単
    _add_pay_group(d, "sanrenpuku", c, 3, 6, 3)  # 3連複
    _add_pay_group(d, "sanrentan", c, 6, 6, 4)   # 3連単
    return d


PARSERS = {"RA": parse_ra, "SE": parse_se, "JG": parse_jg, "HR": parse_hr}


def read_lines(path: str):
    with open(path, "rb") as f:
        for raw_line in f:
            line = raw_line.rstrip(b"\r\n")
            if line:
                yield line


def convert(rec_type: str, indir: str, outdir: str):
    parser = PARSERS[rec_type]
    in_path = os.path.join(indir, f"{rec_type}.txt")
    if not os.path.exists(in_path):
        print(f"スキップ: {in_path} が見つかりません")
        return

    rows = [parser(line) for line in read_lines(in_path)]
    if not rows:
        print(f"スキップ: {in_path} にレコードがありません")
        return

    out_path = os.path.join(outdir, f"{rec_type}_parsed.csv")
    fieldnames = list(rows[0].keys())
    with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"{rec_type}: {len(rows)}件 -> {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("使い方: parse_records.py <indir> <outdir>", file=sys.stderr)
        sys.exit(1)

    _indir, _outdir = sys.argv[1:3]
    os.makedirs(_outdir, exist_ok=True)
    for rt in PARSERS:
        convert(rt, _indir, _outdir)
