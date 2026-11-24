# -*- coding: utf-8 -*-
"""Step 11: 夏/商条目在描述开头补「约公元前X年」，并重建 timeline-events.ts。"""
import json, os, re

ROOT = r"C:\Users\wiledog\Desktop\历史"
TMP = os.path.join(ROOT, ".tmp")
TS = os.path.join(ROOT, "frontend", "data", "timeline-events.ts")
rows = json.load(open(os.path.join(TMP, "final_136.json"), encoding="utf-8"))

# 复用 gen_ts2 的清洗/覆盖逻辑：直接重新执行其生成流程
import importlib.util
spec = importlib.util.spec_from_file_location("gen", os.path.join(TMP, "gen_ts2.py"))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)  # 会生成 ts_block.txt（无约字前缀版）

# 在夏/商条目描述前补「约公元前X年，」
block = open(os.path.join(TMP, "ts_block.txt"), encoding="utf-8").read()
lines = block.split("\n")
out_lines = []
current = {}
for line in lines:
    m = re.match(r'\s*id: "([^"]+)"', line)
    if m:
        current["id"] = m.group(1)
    m2 = re.match(r'\s*year: (-?\d+),', line)
    if m2:
        current["year"] = int(m2.group(1))
    if line.strip().startswith('"') and "（据《史记·" in line:
        m3 = re.search(r'^(\s*)"(.*)"(,?)$', line)
        if m3:
            desc = m3.group(2)
            if current["id"].startswith(("xia-", "shang-")) and not desc.startswith("约公元前"):
                desc = f"约公元前{-current['year']}年，" + desc
            line = f'{m3.group(1)}"{desc}"{m3.group(3)}'
    out_lines.append(line)
block = "\n".join(out_lines)
open(os.path.join(TMP, "ts_block.txt"), "w", encoding="utf-8").write(block)

# 重建文件：头部 + 现有 10 条种子 + 新块
src = open(TS, encoding="utf-8").read()
marker = "export const TIMELINE_EVENTS: readonly TimelineEvent[] = ["
head = src[: src.index(marker) + len(marker)]
rest = src[src.index(marker) + len(marker):]
first_new = rest.index('  {\n    id: "xia-01"')
seed = rest[:first_new].rstrip()
out = head + seed + "\n" + block + "\n];\n"
open(TS, "w", encoding="utf-8", newline="\n").write(out)
print("rebuilt:", len(out), "chars")
print("约字前缀条数:", block.count("约公元前"))
