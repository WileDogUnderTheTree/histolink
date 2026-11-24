# -*- coding: utf-8 -*-
import json
rows = json.load(open(r".tmp\final_136.json", encoding="utf-8"))
order = ["夏","商","西周","春秋","战国"]
out = []
for d in order:
    sub = [r for r in rows if r["dynasty"] == d]
    out.append(f"### {d}（{len(sub)} 条）\n")
    out.append("| 朝代 | 年份 | 事件标题 |")
    out.append("|---|---|---|")
    for r in sub:
        y = f"前{-r['year']}" if r["year"] < 0 else str(r["year"])
        out.append(f"| {d} | {y} | {r['title']} |")
    out.append("")
open(r".tmp\final_list.md","w",encoding="utf-8").write("\n".join(out))
print("ok")
