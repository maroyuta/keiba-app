"""JV-Linkの接続設定(利用キー確認・ダウンロードフォルダ選択等)を行う、初回のみ実行するスクリプト。

`JVSetUIProperties()`はネイティブの「JV-Link設定」ダイアログを開く。これをfetch_raw.py側で
毎回呼ぶと非対話実行(タスクスケジューラでの自動実行等)がダイアログ待ちでブロックされてしまうため、
初回のセットアップ用にこのスクリプトへ分離してある。

実行方法: py -3.12-32 setup.py (32bit Python必須、バージョンは環境に合わせて読み替え)
"""

import sys

import win32com.client

JVLINK_PROGID = "JVDTLab.JVLink"


def main() -> None:
    if sys.maxsize > 2**32:
        raise RuntimeError(
            "64bit Pythonで実行されています。32bit版Pythonで実行し直してください。"
        )

    jvlink = win32com.client.Dispatch(JVLINK_PROGID)
    init_ret = jvlink.JVInit("UNKNOWN")
    if init_ret != 0:
        raise RuntimeError(f"JVInit failed: {init_ret}")

    print("「JV-Link設定」ダイアログを開きます。内容を確認してOK/保存で閉じてください。")
    jvlink.JVSetUIProperties()
    print("設定が完了しました。以降はfetch_raw.pyをそのまま実行できます。")


if __name__ == "__main__":
    main()
