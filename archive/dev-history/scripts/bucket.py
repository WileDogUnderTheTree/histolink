# -*- coding: utf-8 -*-
"""Step 2: bucket parsed events by dynasty window, dedupe, write candidate lists."""
import json, os, re, collections

TMP = r"C:\Users\wiledog\Desktop\历史\.tmp"
events = json.load(open(os.path.join(TMP, "shiji_events.json"), encoding="utf-8"))

def dynasty_of(e):
    y, ch = e.get("year"), e.get("chapter", "")[:3]
    if y is None: return None
    # 夏：本纪 002 的前 2070 以前禹事 + 前2070–前1601
    if ch == "002" and -2100 <= y <= -1601: return "夏"
    if -2070 <= y <= -1601: return "夏"
    if -1600 <= y <= -1047: return "商"
    if -1046 <= y <= -771: return "西周"
    if -770 <= y <= -476: return "春秋"
    if -475 <= y <= -222: return "战国"
    return None

for e in events:
    e["dynasty"] = dynasty_of(e)

def norm(s):
    s = re.sub(r"[（(].*?[）)]", "", s or "")
    s = re.sub(r"[\s·・，。、：:；;“”‘’\"'《》]", "", s)
    return s

# 十表（013/014/015）里的事件名，用于 importance 标记
table_names = [norm(e["event_name"]) for e in events if e["chapter"][:3] in ("013", "014", "015")]
def in_tables(e):
    n = norm(e["event_name"])
    for t in table_names:
        if n and t and (n in t or t in n) and abs(len(n) - len(t)) <= 4:
            return True
    return False

for e in events:
    e["core"] = in_tables(e)

ORDER = ["夏", "商", "西周", "春秋", "战国"]
FILES = {"夏": "cand_1_xia.txt", "商": "cand_2_shang.txt", "西周": "cand_3_zhouwest.txt",
         "春秋": "cand_4_chunqiu.txt", "战国": "cand_5_zhanguo.txt"}

summary = []
for d in ORDER:
    sub = [e for e in events if e["dynasty"] == d]
    # 去重：同年同名（忽略标点/括号）
    seen = {}
    for e in sub:
        key = (e["year"], norm(e["event_name"]))
        if key in seen:
            seen[key].append(e)
        else:
            seen[key] = [e]
    uniq = []
    for key, group in seen.items():
        group.sort(key=lambda x: (-x["core"], -len(x.get("description") or "")))
        uniq.append(group[0])
    uniq.sort(key=lambda e: (e["year"], e["event_name"]))
    summary.append((d, len(sub), len(uniq)))

    lines = []
    for e in uniq:
        desc = (e.get("description") or "").replace("\n", " ")
        lines.append(f"{e['year']:>6} | {e['event_name']:<14s} | {e.get('type',''):<5s} | "
                     f"{e['chapter'][:3]} | {'★' if e['core'] else ' '} | {e['precision']:<8s} | {desc[:40]}")
    with open(os.path.join(TMP, FILES[d]), "w", encoding="utf-8") as f:
        f.write(f"# {d}  原始 {len(sub)} 去重后 {len(uniq)}\n")
        f.write("\n".join(lines) + "\n")
    print(f"{d}: raw={len(sub)} uniq={len(uniq)} -> {FILES[d]}")

print("summary:", summary)
