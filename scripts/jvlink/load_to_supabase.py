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
import urllib.error
import urllib.parse
import urllib.request

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


def to_float_scaled(value: str, scale: float) -> "float | None":
    value = (value or "").strip()
    if not value:
        return None
    try:
        return round(int(value) / scale, 1)
    except ValueError:
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
        "race_class": row.get("jyoken_name") or None,
        "track_type": guess_track_type(row.get("track_cd", "")),
        "distance_m": to_int(row.get("kyori", "")),
        "weather": WEATHER_NAMES.get(row.get("tenko_cd", "")),
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
    return payload


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
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{table}への問い合わせ失敗 ({e.code}): {body}") from e

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
            try:
                with urllib.request.urlopen(req) as resp:
                    results.extend(json.loads(resp.read().decode("utf-8")))
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"{table}へのupsert失敗 ({e.code}): {body}") from e
        return results


def main() -> None:
    parser = argparse.ArgumentParser(description="RA/SE CSVをSupabaseへupsertする")
    parser.add_argument("ra_csv", help="RA_parsed.csvのパス")
    parser.add_argument("se_csv", help="SE_parsed.csvのパス")
    parser.add_argument("--env-file", help=".env.local等のパス (指定時は環境変数より優先しない)")
    parser.add_argument("--hr-csv", help="HR_parsed.csv(払戻情報)のパス。指定時はrace_payoutsへupsertする")
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
            # 出馬表確定前(JV-Dataのdata_kubun=1、umaban未採番)のプレースホルダー行。
            # horse_number=0は実在しない馬番のため、race_entriesには入れずスキップする。
            skipped += 1
            continue
        entry_payloads.append(payload)

    entry_payloads = dedupe_by_key(
        entry_payloads, lambda p: (p["race_id"], p["horse_number"])
    )
    entry_results = client.upsert(
        "race_entries", entry_payloads, on_conflict="race_id,horse_number"
    )
    print(f"[race_entries] {len(entry_results)}件 upsert完了 (skipped={skipped})", file=sys.stderr)

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


if __name__ == "__main__":
    main()
