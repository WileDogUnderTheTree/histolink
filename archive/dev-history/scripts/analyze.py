# -*- coding: utf-8 -*-
"""分析 V0.8.2 数据厚度：分朝事件/参与者、分期节点/边、docs 覆盖率。"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = json.loads((Path(__file__).parent / "data.json").read_text(encoding="utf-8"))

DYNASTY_ORDER = ["夏", "商", "西周", "春秋", "战国", "秦", "西汉", "东汉", "三国", "西晋",
                 "东晋十六国", "南北朝", "隋", "唐", "五代十国", "辽", "北宋", "西夏", "金",
                 "南宋", "元", "明", "清"]

events = DATA["events"]
rels = DATA["relations"]
by_dynasty = {}
for e in events:
    by_dynasty.setdefault(e["dynasty"], []).append(e)

print("=== 分朝事件厚度 ===")
print(f"{'朝代':<8}{'事件':>4}{'有参与者':>7}{'参与人次':>7}{'唯一人物':>7}")
total_people = 0
for d in DYNASTY_ORDER:
    es = by_dynasty.get(d, [])
    with_p = [e for e in es if e.get("participants")]
    slots = sum(len(e["participants"]) for e in with_p)
    people = set()
    for e in with_p:
        people.update(e["participants"])
    total_people += len(people)
    print(f"{d:<8}{len(es):>4}{len(with_p):>7}{slots:>7}{len(people):>7}")
print(f"合计事件 {len(events)}，参与者条目 {sum(1 for e in events if e.get('participants'))}")

print("\n=== 分期节点 / 边 / 关系覆盖 ===")
for era in DATA["eras"]:
    print(f"{era['label']:<10} {era['id']:<12} nodes={era['nodes']:>3} edges={era['edges']:>3} center={era['defaultCenterPersonId']}")
for scope in DATA["scopes"]:
    print(f"[简阅] {scope['label']:<10} {scope['id']:<12} nodes={scope['nodes']:>3} edges={scope['edges']:>3} center={scope['defaultCenterPersonId']}")

# 关系覆盖：按事件参与者重建边（与 buildPersonGraph 口径一致）
def build_edges(event_list):
    pair = {}
    for e in event_list:
        ps = list(dict.fromkeys(p.strip() for p in e.get("participants") or [] if p.strip()))
        for i in range(len(ps)):
            for j in range(i + 1, len(ps)):
                key = "__".join(sorted((ps[i], ps[j])))
                pair.setdefault(key, []).append(e["id"])
    return pair

rel_keys = {"__".join(sorted((r["a"], r["b"]))) for r in rels}
print("\n=== 关系库 ===")
print(f"关系对数 {len(rels)}，唯一 pairKey {len(rel_keys)}")
dup = len(rels) - len(rel_keys)
print(f"重复 pairKey {dup}")

# 每期关系覆盖
era_by_id = {e["id"]: e for e in DATA["eras"]}
scope_by_id = {s["id"]: s for s in DATA["scopes"]}

def era_events(era_id):
    # 近似：与 person-graph 构建口径尽量一致（按朝代取事件；特殊白名单期另行说明）
    era = era_by_id[era_id]
    allowed = set(era["dynasties"])
    return [e for e in events if e["dynasty"] in allowed]

print("\n=== docs 01-06 覆盖检查 ===")
DOC_FILES = ["01_先秦.md", "02_秦汉.md", "03_魏晋南北朝.md", "04_隋唐.md", "05_宋辽夏金.md", "06_元明清.md"]
title_index = {}
for e in events:
    title_index.setdefault(e["title"], []).append(e)
    norm = re.sub(r"[·\s（）()]", "", e["title"])
    title_index.setdefault("~" + norm, []).append(e)

def match(title):
    if title in title_index:
        return title_index[title]
    norm = re.sub(r"[·\s（）()]", "", title)
    return title_index.get("~" + norm, [])

for fname in DOC_FILES:
    text = (ROOT / "docs" / fname).read_text(encoding="utf-8")
    rows = [line for line in text.splitlines() if line.strip().startswith("|") and "---" not in line]
    rows = rows[1:]  # 表头
    missing = []
    for row in rows:
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        if len(cells) < 5:
            continue
        dynasty, year, title, people, desc = cells[:5]
        hits = match(title)
        if not hits:
            missing.append((dynasty, year, title, people))
    print(f"\n{fname}: 共 {len(rows)} 行，未覆盖 {len(missing)} 行")
    for m in missing:
        print("   MISS", m)

# 输出每朝事件标题清单，供增补参考
out = Path(__file__).parent / "existing_titles.txt"
with out.open("w", encoding="utf-8") as f:
    for d in DYNASTY_ORDER:
        f.write(f"\n## {d}（{len(by_dynasty.get(d, []))} 条）\n")
        for e in sorted(by_dynasty.get(d, []), key=lambda x: (x["year"], x["id"])):
            ppl = "、".join(e.get("participants") or [])
            f.write(f"- {e['id']} | {e['year']} | {e['title']} | {ppl}\n")
print(f"\n已写出 {out}")
