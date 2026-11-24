# -*- coding: utf-8 -*-
"""Explore shiji-kb metro_map_data.json: counts by era for batch 1 (夏商周)."""
import json, sys, collections

path = r"C:\Users\wiledog\AppData\Local\Temp\metro_map_data.json"
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

print("meta:", {k: v for k, v in data["meta"].items() if k != "groups"})

stations = []
for line in data["lines"]:
    for s in line["stations"]:
        s = dict(s)
        s["line_name"] = line["name"]
        stations.append(s)
print("stations:", len(stations))
print("sample keys:", sorted(stations[0].keys()))

# transfers
tr = data.get("transfers", [])
print("transfers:", len(tr), "types:", collections.Counter(t.get("type") for t in tr))

def bucket(y):
    if y is None:
        return "no-year"
    if y < -2070:
        return "五帝/传说(<前2070)"
    if y <= -1601:
        return "夏(前2070-前1600)"
    if y <= -1047:
        return "商(前1600-前1046)"
    if y <= -772:
        return "西周(前1046-前771)"
    if y <= -477:
        return "春秋(前770-前476)"
    if y <= -222:
        return "战国(前475-前221)"
    if y <= -207:
        return "秦(前221-前207)"
    return "汉及以后(>前207)"

order = ["五帝/传说(<前2070)", "夏(前2070-前1600)", "商(前1600-前1046)", "西周(前1046-前771)",
         "春秋(前770-前476)", "战国(前475-前221)", "秦(前221-前207)", "汉及以后(>前207)", "no-year"]
cnt = collections.Counter(bucket(s.get("year")) for s in stations)
print("\n=== 按年份区间 ===")
for k in order:
    print(f"{k:28s} {cnt.get(k, 0)}")

BATCH1 = set(order[:6])
b1 = [s for s in stations if bucket(s.get("year")) in BATCH1]
print("\nbatch1 stations:", len(b1))

print("\n=== batch1 事件类型分布 ===")
for k, v in collections.Counter(s.get("type") for s in b1).most_common():
    print(f"  {k:8s} {v}")

print("\n=== batch1 章节贡献 Top30 ===")
for k, v in collections.Counter((s["chapter"], s["chapter_name"]) for s in b1).most_common(30):
    print(f"  {k[0]} {k[1]:14s} {v}")

# cross_ref duplicate pairs within batch1
ids = {s["id"] for s in b1}
pairs = []
for t in tr:
    ev = t.get("events") or []
    if len(ev) == 2 and ev[0] in ids and ev[1] in ids:
        pairs.append(t)
print("\nbatch1 内部换乘/重复对:", len(pairs), collections.Counter(t.get("type") for t in pairs))
dup_nodes = set()
for t in pairs:
    dup_nodes.update(t["events"])
print("batch1 涉及重复的事件数:", len(dup_nodes))

# field completeness in batch1
for field in ("description", "quote", "people", "locations", "time_raw"):
    have = sum(1 for s in b1 if s.get(field))
    print(f"字段 {field:12s} 非空: {have}/{len(b1)}")

# year precision markers
import re
prec = collections.Counter()
for s in b1:
    raw = s.get("time_raw") or ""
    if "约公元前" in raw:
        prec["约/推断(约)"] += 1
    elif re.search(r"\[\s*公元前", raw) or "[" in raw:
        prec["推断([ ])"] += 1
    elif "公元前" in raw:
        prec["精确(（ ）)"] += 1
    else:
        prec["无公元标注"] += 1
print("\n=== batch1 年份精度 ===", dict(prec))

# 春秋/战国 type breakdown
for era in ("春秋(前770-前476)", "战国(前475-前221)"):
    sub = [s for s in stations if bucket(s.get("year")) == era]
    print(f"\n=== {era} 类型分布 ===")
    for k, v in collections.Counter(s.get("type") for s in sub).most_common():
        print(f"  {k:8s} {v}")
