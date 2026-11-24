# -*- coding: utf-8 -*-
"""为 10 条老事件补出处括注（V0.8.2 一致性收尾）。"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / "frontend" / "data" / "timeline-events.ts"
text = path.read_text(encoding="utf-8")

CITES = {
    "qin-unify": "（据《史记·秦始皇本纪》）",
    "qin-book-burning": "（据《史记·秦始皇本纪》）",
    "qin-daze-uprising": "（据《史记·陈涉世家》）",
    "han-founded": "（据《史记·高祖本纪》）",
    "han-seven-states": "（据《史记·吴王濞列传》）",
    "han-zhang-qian": "（据《史记·大宛列传》）",
    "han-xiyu-protectorate": "（据《汉书·郑吉传》）",
    "han-wang-mang": "（据《汉书·王莽传》）",
    "han-cai-lun": "（据《后汉书·宦者列传》）",
    "han-yellow-turban": "（据《后汉书·皇甫嵩传》）",
}

patched = 0
for event_id, cite in CITES.items():
    pattern = re.compile(
        r'(id: "' + re.escape(event_id) + r'",[\s\S]*?description:\n      ")([^"]*)(")'
    )
    match = pattern.search(text)
    assert match, event_id
    body = match.group(2)
    if "据《" in body:
        continue
    text = text[: match.start(2)] + body + cite + text[match.end(2):]
    patched += 1

path.write_text(text, encoding="utf-8")
print(f"patched {patched} events")
