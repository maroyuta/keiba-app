"""JV-Linkの速報系API JVRTOpen を使い、指定レースの単勝・複勝・枠連オッズ(レコード種別"O1")を
リアルタイム取得して保存する。

fetch_raw.py が使う JVOpen(蓄積系、レース確定後のデータ)とは別のAPIで、発売開始後
(金土日に随時更新)のオッズをレース単位でその場から取得できる。ダウンロード予約が不要な
即時取得APIのため、fetch_raw.pyのようなJVStatusでの完了待ちループは無い。

race_keyのフォーマット: races.jv_race_key(12桁: 年4+場コード2+回2+日目2+レース番号2)とは異なり、
RACE_ID構造体と同じ16桁(年4+月日4+場コード2+回2+日目2+レース番号2)。実機で
JVRTOpen("0B31", "2026071203020611")が七夕賞(2026-07-12, 福島2回6日目11R)のO1レコードを
実際に返すことを確認済み。

前提:
- Windows PC上で32bit Pythonから実行すること (fetch_raw.pyと同じ制約)
- JV-Link接続設定(setup.py)が済んでいること

使い方:
    py -3.12-32 fetch_odds.py <race_key> <outdir>
例:
    py -3.12-32 fetch_odds.py 2026071203020611 out
"""

import argparse
import sys
from pathlib import Path

import win32com.client

from mojibake import fix_mojibake

JVLINK_PROGID = "JVDTLab.JVLink"
READ_BUFFER_SIZE = 300000
ODDS_DATASPEC = "0B31"


def fetch_odds(race_key: str, out_dir: Path, apply_mojibake_fix: bool) -> None:
    if sys.maxsize > 2**32:
        raise RuntimeError(
            "64bit Pythonで実行されています。JV-LinkはWindows専用の32bit COMコンポーネントのため、"
            "32bit版Pythonをインストールして実行し直してください。"
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    file_handles: dict[str, "TextIO"] = {}

    jvlink = win32com.client.Dispatch(JVLINK_PROGID)

    init_ret = jvlink.JVInit("UNKNOWN")
    if init_ret != 0:
        raise RuntimeError(f"JVInit failed: {init_ret}")

    open_ret = jvlink.JVRTOpen(ODDS_DATASPEC, race_key)
    if open_ret != 0:
        jvlink.JVClose()
        raise RuntimeError(f"JVRTOpen failed: errcode={open_ret} (race_key={race_key})")

    print(f"[JVRTOpen] dataspec={ODDS_DATASPEC} race_key={race_key} ok", file=sys.stderr)

    total_records = 0
    try:
        while True:
            ret = jvlink.JVRead("", READ_BUFFER_SIZE, "")
            status = ret[0]

            if status == 0:
                break
            if status == -1:
                print(f"[JVRead] ファイル切り替わり: {ret[2]}", file=sys.stderr)
                continue
            if status < -1:
                raise RuntimeError(f"JVRead error: {status}")

            data = ret[1]
            if apply_mojibake_fix:
                data = fix_mojibake(data)
            record_id = data[:2]
            if record_id not in file_handles:
                file_handles[record_id] = open(
                    out_dir / f"{record_id}.txt", "a", encoding="cp932", errors="replace", newline=""
                )
            file_handles[record_id].write(data.rstrip("\r\n") + "\n")
            total_records += 1
    finally:
        for fh in file_handles.values():
            fh.close()
        jvlink.JVClose()

    print(f"[完了] 合計{total_records}件のレコードを{out_dir}に保存しました。", file=sys.stderr)
    print(f"レコード種別: {sorted(file_handles.keys())}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="JVRTOpenでレース単位のリアルタイムオッズ(O1)を取得する"
    )
    parser.add_argument(
        "race_key", help="16桁のレースキー (年4+月日4+場コード2+回2+日目2+レース番号2)"
    )
    parser.add_argument("out_dir", help="生レコードの保存先ディレクトリ")
    parser.add_argument(
        "--fix-mojibake",
        action="store_true",
        help="fetch_raw.pyと同じ文字化け復元処理(必要な環境のみ指定)",
    )
    args = parser.parse_args()

    fetch_odds(args.race_key, Path(args.out_dir), args.fix_mojibake)


if __name__ == "__main__":
    main()
