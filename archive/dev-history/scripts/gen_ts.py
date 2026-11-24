# -*- coding: utf-8 -*-
"""Step 7: 生成 timeline-events.ts 的 136 条 TS 代码块 + 描述审阅稿。"""
import json, os, re

TMP = r"C:\Users\wiledog\Desktop\历史\.tmp"
rows = json.load(open(os.path.join(TMP, "final_136.json"), encoding="utf-8"))

PREFIX = {"夏": "xia", "商": "shang", "西周": "xizhou", "春秋": "chunqiu", "战国": "zhanguo"}

def clean(s):
    s = re.sub(r"〖[@=;&%~+!?]?", "", s or "")
    s = s.replace("〗", "").replace("〖", "")
    s = re.sub(r"\s+", "", s)
    s = s.replace("《", "《").replace("》", "》")
    return s.strip()

def trim(s, limit=78):
    s = clean(s)
    if len(s) <= limit:
        return s
    # 优先在句号/分号处截断
    for mark in ("。", "；"):
        idx = s.rfind(mark, 0, limit + 1)
        if idx >= 40:
            return s[: idx + 1]
    # 其次在逗号/顿号处截断
    for mark in ("，", "、"):
        idx = s.rfind(mark, 0, limit + 1)
        if idx >= 40:
            return s[:idx] + "。"
    return s[:limit] + "。"

def chapter_name(ch):
    return ch.split("_")[1]

def suffix(r):
    name = chapter_name(r["chapter"])
    if r["dynasty"] in ("夏", "商"):
        return f"（据《史记·{name}》；夏商年代依夏商周断代工程推定）"
    return f"（据《史记·{name}》）"

# 手动覆盖：自动截断后语句不完整或需强调「约」的条目（键=源ID）
OVERRIDE = {}

n = {}
ts = []
review = []
for r in rows:
    dyn = r["dynasty"]
    n[dyn] = n.get(dyn, 0) + 1
    eid = f"{PREFIX[dyn]}-{n[dyn]:02d}"
    body = OVERRIDE.get(r["event_id"]) or trim(r["description"])
    desc = body + suffix(r)
    ts.append(
        "  {\n"
        f'    id: "{eid}",\n'
        f'    title: "{r["title"]}",\n'
        f'    dynasty: "{dyn}",\n'
        f'    year: {r["year"]},\n'
        f'    description:\n      "{desc}",\n'
        "  },"
    )
    review.append(f"{eid} | {dyn} {r['year']} | {r['title']}\n    {desc}")

open(os.path.join(TMP, "ts_block.txt"), "w", encoding="utf-8").write("\n".join(ts))
open(os.path.join(TMP, "desc_review.txt"), "w", encoding="utf-8").write("\n\n".join(review))
print("events:", len(ts))
print("desc len min/max:", min(len(x) for x in review), max(len(x) for x in review))
