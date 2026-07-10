"""JV-LinkのBSTRが、システムロケール(非Unicodeプログラム用言語)が日本語でないWindows環境で
CP1252として誤変換される問題を復元するユーティリティ。

⚠️ 未検証 (2026-07-11時点): Windows実機のデバッグで発見・報告された現象と対処法を移植したもので、
実際の文字化けデータを使ったMac環境での再現・検証はできていない。fetch_raw.pyでは
`--fix-mojibake`フラグで明示的に有効化した場合のみ適用する(システムロケールが日本語で
この問題が発生しない環境で誤って正常なデータを壊さないため)。

技術的背景: Windows実装のCP1252は公式Unicode変換表と異なり、未定義の5バイト
(0x81, 0x8D, 0x8F, 0x90, 0x9D)を恒等変換(バイト値=コードポイント値)として扱う。
Pythonの標準`cp1252`コーデックはこれらを未定義のままにしているため、独自の変換表で補う。
"""

_CP1252_UNDEFINED_BYTES = (0x81, 0x8D, 0x8F, 0x90, 0x9D)


def _build_decode_table() -> dict:
    table = {}
    for byte in range(256):
        if byte in _CP1252_UNDEFINED_BYTES:
            table[byte] = byte  # Windows実装は恒等変換
        else:
            table[byte] = ord(bytes([byte]).decode("cp1252"))
    return table


_DECODE_TABLE = _build_decode_table()
_ENCODE_TABLE = {codepoint: byte for byte, codepoint in _DECODE_TABLE.items()}


def fix_mojibake(text: str) -> str:
    """CP1252として誤変換された文字列を、想定される元のcp932バイト列から復元する。

    変換できない文字が含まれる場合(そもそも壊れていない正常な文字列だった場合など)は
    元の文字列をそのまま返す。
    """
    try:
        raw_bytes = bytes(_ENCODE_TABLE[ord(c)] for c in text)
        return raw_bytes.decode("cp932")
    except (KeyError, UnicodeDecodeError):
        return text
