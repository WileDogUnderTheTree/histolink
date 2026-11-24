# -*- coding: utf-8 -*-
"""验证错层算法：每个朝代需要多少层、同层最小间距、跨层视觉距离。"""
import json, math, os

TMP = r"C:\Users\wiledog\Desktop\历史\.tmp"
rows = json.load(open(os.path.join(TMP, "final_136.json"), encoding="utf-8"))
PAD = 6
ORDER = ["夏", "商", "西周", "春秋", "战国"]

def to_astro(y):
    return y + 1 if y < 0 else y

for GAP in (1.2, 1.5, 2.0):
    print(f"\n===== STACK_GAP={GAP}% =====")
    for dyn in ORDER:
        sub = [r for r in rows if r["dynasty"] == dyn]
        adj = [to_astro(r["year"]) for r in sub]
        mn, mx = min(adj), max(adj)
        span = mx - mn
        last = []
        levels = []
        lefts = []
        for a in adj:
            left = 50 if span == 0 else PAD + ((a - mn) / span) * (100 - 2 * PAD)
            lv = 0
            while lv < len(last) and left - last[lv] < GAP:
                lv += 1
            if lv == len(last):
                last.append(left)
            else:
                last[lv] = left
            levels.append(lv)
            lefts.append(left)
        maxlv = max(levels)
        # 同层最小间距
        same = []
        for lv in range(maxlv + 1):
            xs = sorted(lefts[i] for i in range(len(sub)) if levels[i] == lv)
            for a, b in zip(xs, xs[1:]):
                same.append(b - a)
        # 跨层最小水平距离
        cross = []
        for i in range(len(sub)):
            for j in range(i + 1, len(sub)):
                if levels[i] != levels[j]:
                    cross.append(abs(lefts[i] - lefts[j]))
        print(f"{dyn:3s} n={len(sub):2d} maxLevel={maxlv} 同层最小间距={min(same) if same else 0:.2f}% "
              f"跨层最小水平距离={min(cross) if cross else 0:.2f}%")
