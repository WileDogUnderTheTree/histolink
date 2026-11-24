# -*- coding: utf-8 -*-
"""Step 10: 校验生成的 timeline-events.ts（条目数/唯一性/年份/排序/错层模拟）。"""
import re, os, collections

ROOT = r"C:\Users\wiledog\Desktop\历史"
src = open(os.path.join(ROOT, "frontend", "data", "timeline-events.ts"), encoding="utf-8").read()

entries = re.findall(
    r'\{\s*id: "([^"]+)",\s*title: "([^"]+)",\s*dynasty: "([^"]+)",\s*year: (-?\d+),\s*description:\s*"([^"]+)"',
    src, re.S)
print("entries:", len(entries))

ids = [e[0] for e in entries]
print("唯一 id:", len(set(ids)) == len(ids), "重复:", [k for k, v in collections.Counter(ids).items() if v > 1])
print("年份为 0:", [e for e in entries if int(e[3]) == 0])
print("朝代分布:", dict(collections.Counter(e[2] for e in entries)))
dup = [k for k, v in collections.Counter((e[2], e[3], e[1]) for e in entries).items() if v > 1]
print("同朝同年同名:", dup)

ALLOWED = {"夏", "商", "西周", "春秋", "战国", "秦", "汉"}
print("非法朝代:", [e[2] for e in entries if e[2] not in ALLOWED])
print("描述长度 min/avg/max:",
      min(len(e[4]) for e in entries),
      sum(len(e[4]) for e in entries) // len(entries),
      max(len(e[4]) for e in entries))
print("缺出处括注:", [e[0] for e in entries if "据《史记·" not in e[4]])

# 按页面逻辑模拟排序与错层
PAD, GAP, STEP, MAXOFF = 6, 1.2, 20, 40
START = {"夏": -2070, "商": -1600, "西周": -1046, "春秋": -770, "战国": -475, "秦": -221, "汉": -202}
def astro(y): return y + 1 if y < 0 else y

print("\n各朝代时间轴布局：")
for dyn in sorted({e[2] for e in entries}, key=lambda d: START[d]):
    sub = [e for e in entries if e[2] == dyn]
    sub = sorted(sub, key=lambda e: (astro(int(e[3])), e[1]))
    years = [astro(int(e[3])) for e in sub]
    mn, mx = min(years), max(years)
    span = mx - mn
    last, rows, maxlv = [], [], 0
    for e in sub:
        left = 50 if span == 0 else PAD + ((astro(int(e[3])) - mn) / span) * (100 - 2 * PAD)
        lv = 0
        while lv < len(last) and left - last[lv] < GAP:
            lv += 1
        if lv == len(last):
            last.append(left)
        else:
            last[lv] = left
        maxlv = max(maxlv, lv)
        rows.append((left, lv))
    offs = {lv: (0 if lv == 0 else (-1 if lv % 2 else 1) * min(STEP * ((lv + 1) // 2), MAXOFF)) for _, lv in rows}
    sorted_ok = all(int(sub[i][3]) <= int(sub[i + 1][3]) for i in range(len(sub) - 1))
    print(f"  {dyn:3s} n={len(sub):2d} 年份升序={sorted_ok} 最大层={maxlv} "
          f"左端={rows[0][0]:.2f}% 右端={rows[-1][0]:.2f}% 偏移集={sorted(set(offs.values()))}")
