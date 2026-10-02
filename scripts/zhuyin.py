"""stdin: 每行一個 JSON 字串；stdout: 每行一個 JSON 陣列（逐字注音，非漢字為 null）。
由 build-index.mjs 經 `uv run --with pypinyin python scripts/zhuyin.py` 呼叫。"""
import json
import sys

from pypinyin import Style, pinyin

# 詞級覆寫表：先比對多字詞（長詞優先），再逐字查 pypinyin。老師可直接在此新增。
# 格式：「詞」: ["每", "字", "的", "注", "音"]（長度須等於詞的字數）
OVERRIDES = {
    "項為之強": ["ㄒㄧㄤˋ", "ㄨㄟˋ", "ㄓ", "ㄐㄧㄤˋ"],
    "癩蝦蟆": ["ㄌㄞˋ", "ㄏㄚˊ", "ㄇㄚˊ"],
    "蝦蟆": ["ㄏㄚˊ", "ㄇㄚˊ"],
    "拔山倒樹": ["ㄅㄚˊ", "ㄕㄢ", "ㄉㄠˇ", "ㄕㄨˋ"],
    "怡然稱快": ["ㄧˊ", "ㄖㄢˊ", "ㄔㄥ", "ㄎㄨㄞˋ"],
    "素帳": ["ㄙㄨˋ", "ㄓㄤˋ"],
    "鞭數十": ["ㄅㄧㄢ", "ㄕㄨˋ", "ㄕˊ"],
}

NEUTRAL = "˙"
_KEYS = sorted(OVERRIDES, key=len, reverse=True)


def _char_zhuyin(text):
    out = []
    for ch, py in zip(text, pinyin(text, style=Style.BOPOMOFO, heteronym=False, errors=lambda s: [None] * len(s))):
        z = py[0]
        if not z or z == ch:  # 非漢字或查無注音
            out.append(None)
            continue
        if z.endswith(NEUTRAL):  # 臺灣慣例：輕聲符號放前面
            z = NEUTRAL + z[:-1]
        out.append(z)
    return out


def bopomofo(text):
    out = []
    i = 0
    buf = ""
    while i < len(text):
        hit = next((k for k in _KEYS if text.startswith(k, i)), None)
        if hit:
            out.extend(_char_zhuyin(buf))
            buf = ""
            out.extend(OVERRIDES[hit])
            i += len(hit)
        else:
            buf += text[i]
            i += 1
    out.extend(_char_zhuyin(buf))
    return out


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    print(json.dumps(bopomofo(json.loads(line)), ensure_ascii=False), flush=True)
