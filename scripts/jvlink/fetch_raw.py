"""JV-Linkに接続し、指定したdataspecの生レコードを取得してレコード種別ごとのファイルに保存する。

このスクリプトはフィールド単位のパース(バイトオフセットでの項目切り出し)は一切行わない。
JV-Dataの各レコードは先頭2文字がレコード種別ID (例: "RA"=レース詳細、"SE"=馬毎レース情報等) になっている
一般的な構造を利用して、種別ごとに行を振り分けて保存するだけ。実際にSupabaseのraces/horses等へ
書き込むには、このあとJV-Data仕様書 (JV-Data4901.xlsx) でレコード種別ごとのフィールド定義を確認し、
別途パーサーを実装する必要がある。

前提:
- Windows PC上で実行すること (JV-LinkはWindows専用のCOMコンポーネント)
- 32bit版Pythonであること (JV-Linkは32bit COMサーバーのため、64bit Pythonからは呼べない)
- pip install pywin32 が実行済みであること
- JV-Link自体がインストール済みで、利用キーが設定済みであること
- 接続設定(JVSetUIProperties)は初回のみ `setup.py` を別途実行して済ませておくこと。
  非対話実行(タスクスケジューラ等)でダイアログにブロックされないよう、このスクリプトからは
  意図的に呼んでいない

参考にしたJVOpen/JVRead呼び出しパターン (win32com経由の戻り値の形):
- JVOpen(dataspec, fromtime, option, 0, 0, '') -> [errcode, readcount, downloadcount, lastfiletimestamp]
- JVRead("", bufsize, "") -> [status, data, filename]
  status: 0=全ファイル読了, -1=ファイル切り替わり(このコールにはデータなし), 負数(-1以外)=エラー, 正数=データ長
"""

import argparse
import sys
import time
from pathlib import Path

# win32comはWindows専用。Mac/Linux上ではimport自体が失敗するため、
# このスクリプトはWindows PC上でのみ実行できる。
import win32com.client

from mojibake import fix_mojibake

JVLINK_PROGID = "JVDTLab.JVLink"
READ_BUFFER_SIZE = 300000


def fetch(dataspec: str, fromtime: str, option: int, out_dir: Path, apply_mojibake_fix: bool) -> None:
    if sys.maxsize > 2**32:
        raise RuntimeError(
            "64bit Pythonで実行されています。JV-LinkはWindows専用の32bit COMコンポーネントのため、"
            "32bit版Pythonをインストールして実行し直してください "
            "(このまま実行するとJVDTLab.JVLinkの生成時にREGDB_E_CLASSNOTREGエラーになります)。"
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    file_handles: dict[str, "TextIO"] = {}

    jvlink = win32com.client.Dispatch(JVLINK_PROGID)

    init_ret = jvlink.JVInit("UNKNOWN")
    if init_ret != 0:
        raise RuntimeError(f"JVInit failed: {init_ret}")

    open_ret = jvlink.JVOpen(dataspec, fromtime, option, 0, 0, "")
    errcode, readcount, downloadcount, lastfiletimestamp = open_ret
    if errcode < 0:
        raise RuntimeError(f"JVOpen failed: errcode={errcode}")

    print(
        f"[JVOpen] dataspec={dataspec} fromtime={fromtime} option={option} "
        f"readcount={readcount} downloadcount={downloadcount} lastfiletimestamp={lastfiletimestamp}",
        file=sys.stderr,
    )

    # ダウンロードが必要な分がある場合、JVStatusで完了を待つ。
    while downloadcount > 0:
        status = jvlink.JVStatus()
        if status < 0:
            raise RuntimeError(f"JVStatus error: {status}")
        print(f"[JVStatus] downloaded {status}/{downloadcount}", file=sys.stderr)
        if status >= downloadcount:
            break
        time.sleep(1)

    total_records = 0
    current_file = None
    try:
        while True:
            ret = jvlink.JVRead("", READ_BUFFER_SIZE, "")
            status = ret[0]

            if status == 0:
                break
            if status == -1:
                current_file = ret[2]
                print(f"[JVRead] ファイル切り替わり: {current_file}", file=sys.stderr)
                continue
            if status < -1:
                raise RuntimeError(f"JVRead error: {status}")

            data = ret[1]
            if apply_mojibake_fix:
                data = fix_mojibake(data)
            record_id = data[:2]
            if record_id not in file_handles:
                file_handles[record_id] = open(
                    out_dir / f"{record_id}.txt", "a", encoding="cp932", errors="replace"
                )
            file_handles[record_id].write(data + "\n")
            total_records += 1

            if total_records % 1000 == 0:
                print(f"[JVRead] {total_records}件処理...", file=sys.stderr)
    finally:
        for fh in file_handles.values():
            fh.close()
        jvlink.JVClose()

    print(f"[完了] 合計{total_records}件のレコードを{out_dir}に保存しました。", file=sys.stderr)
    print(f"レコード種別: {sorted(file_handles.keys())}", file=sys.stderr)

    # 差分同期用: 次回JVOpenのfromtimeにそのまま使えるlastfiletimestampを保存しておく。
    # option=1(通常データ)実行時のみ意味を持つ(option=2/3/4では差分の起点にしない)。
    if option == 1 and lastfiletimestamp:
        (out_dir / "last_sync.txt").write_text(str(lastfiletimestamp), encoding="utf-8")
        print(f"[差分同期] last_sync.txt に {lastfiletimestamp} を保存しました。", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="JV-Linkから生データを取得してレコード種別ごとに保存する")
    parser.add_argument("dataspec", help='例: "RACE", "RACESLOPWOOD" (4桁データ種別IDの連結)')
    parser.add_argument(
        "fromtime",
        help='option=1,3,4は "YYYYMMDDhhmmss" または "YYYYMMDDhhmmss-YYYYMMDDhhmmss" 形式。option=2は"1"固定',
    )
    parser.add_argument("option", type=int, choices=[1, 2, 3, 4], help="JVOpenのoptionパラメータ")
    parser.add_argument("out_dir", help="生レコードの保存先ディレクトリ")
    parser.add_argument(
        "--fix-mojibake",
        action="store_true",
        help="システムロケールが日本語でない環境でJV-LinkのBSTRがCP1252として誤変換される"
        "問題の復元処理を有効にする(mojibake.py参照)。文字化けが出る場合のみ指定すること",
    )
    args = parser.parse_args()

    fetch(args.dataspec, args.fromtime, args.option, Path(args.out_dir), args.fix_mojibake)


if __name__ == "__main__":
    main()
