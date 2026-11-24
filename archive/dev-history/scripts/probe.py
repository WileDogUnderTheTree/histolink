# -*- coding: utf-8 -*-
"""Step 4: keyword probes for canonical 春秋战国 events missing/uncertain in candidate lists."""
import json, os, re

TMP = r"C:\Users\wiledog\Desktop\历史\.tmp"
events = json.load(open(os.path.join(TMP, "shiji_events.json"), encoding="utf-8"))

def dynasty_of(e):
    y, ch = e.get("year"), e.get("chapter", "")[:3]
    if y is None: return None
    if ch == "002" and -2100 <= y <= -1601: return "夏"
    if -2070 <= y <= -1601: return "夏"
    if -1600 <= y <= -1047: return "商"
    if -1046 <= y <= -771: return "西周"
    if -770 <= y <= -476: return "春秋"
    if -475 <= y <= -222: return "战国"
    return None

for e in events:
    e["dynasty"] = dynasty_of(e)

KEYS = ["弭兵", "向戌", "刑书", "铸刑", "长勺", "曹刿", "邗沟", "都江堰", "郑国渠", "李冰",
        "李悝", "吴起", "稷下", "百家", "孟子", "庄子", "荀子", "韩非", "孙膑", "桂陵", "马陵",
        "合纵", "连横", "苏秦", "张仪", "乐毅", "田单", "范雎", "长平", "信陵", "春申", "平原君",
        "孟尝君", "胡服", "五国", "伊阙", "华阳", "鄢郢", "灭韩", "灭赵", "灭魏", "灭楚",
        "灭燕", "灭齐", "荆轲", "田和", "田氏", "三家", "韩赵魏", "魏文侯", "魏惠", "商鞅",
        "赵武灵", "秦昭", "吕不韦", "嫪毐", "白起", "王翦", "李斯", "韩昭侯", "申不害", "邹忌",
        "齐威王", "桂陵之战", "逢泽", "徐州相王", "五国相王"]

seen_chapters = {}
for k in KEYS:
    hits = [e for e in events if k in (e.get("event_name") or "")]
    if not hits:
        print(f"[缺] {k}")
        continue
    print(f"[有] {k}")
    for e in sorted(hits, key=lambda x: (x["year"] or 9999)):
        print(f"      {e['year']} | {e['event_name']} | {e.get('type')} | {e['chapter'][:3]} | {(e.get('description') or '')[:45]}")
