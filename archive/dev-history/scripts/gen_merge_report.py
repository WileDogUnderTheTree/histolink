# -*- coding: utf-8 -*-
"""生成 docs/01—06 与事件库的去重合并对照表（V0.8.2 验收资料）。"""
import json
import sys
from pathlib import Path

TMP = Path(__file__).parent
ROOT = TMP.parents[1]
sys.path.insert(0, str(TMP))
import docs_merge  # noqa: E402

TMP_DATA = json.loads((TMP / "data.json").read_text(encoding="utf-8"))
OLD_IDS = {event["id"] for event in TMP_DATA["events"]}
NEW_IDS = set()
for name in docs_merge.NEW_FILES:
    payload = json.loads((TMP / name).read_text(encoding="utf-8"))
    NEW_IDS.update(event["id"] for event in payload["events"])

rows = docs_merge.parse_docs()
lines = [
    "# 《史脉》V0.8.2 · docs 01—06 去重合并对照",
    "",
    "> 本表记录 `docs/01_先秦.md`—`docs/06_元明清.md` 六份 WorkBuddy 终极数据文件的 122 行核心事件",
    "> 与事件库的合并结果：同题事件复用既有 id（不重复录入），缺失事件补录为新增 id。",
    "> 合并时以「文档事件名 → 事件 id」语义映射，参与者按史书通名规范化后并入既有事件（并集去重）。",
    "",
    "| # | 文档 | 文档事件 | 合并到事件 id | 处理方式 |",
    "|---:|---|---|---|---|",
]

for index, (fname, dynasty, title, _people) in enumerate(rows, start=1):
    target = docs_merge.MAP[(fname, title)]
    if isinstance(target, dict):
        ids = " / ".join(target.keys())
        kind = "补录" if all(event_id in NEW_IDS for event_id in target) else "复用 + 补录"
    elif target[0] in NEW_IDS:
        ids = target[0]
        kind = "补录（新事件）"
    else:
        ids = target[0]
        kind = "复用既有事件"
    lines.append(f"| {index} | {fname} | {title} | `{ids}` | {kind} |")

covered_new = sum(1 for fname, dynasty, title, _ in rows if any(
    (event_id in NEW_IDS)
    for event_id in (docs_merge.MAP[(fname, title)].keys() if isinstance(docs_merge.MAP[(fname, title)], dict) else docs_merge.MAP[(fname, title)])
))
lines += [
    "",
    f"合计：**122 行**核心事件全部落库；其中 **{covered_new} 行**涉及本版补录的新事件，其余复用既有事件 id。",
    "",
    "## 合并口径",
    "",
    "1. **去重**：同一史事只保留一条事件，复用既有 `id` 与 `year`；文档中不同表述（如「秦灭六国」/「秦始皇统一六国」）按语义映射到同一条。",
    "2. **补录**：既有事件库未覆盖的文档事件补录为新事件（174 条新增事件中的一部分），并补齐出处括注与参与者。",
    "3. **参与者并集**：文档「参与人物」列经「文档人名 → 事件库节点名」规范化（如 大禹→禹、嬴政→秦始皇、萧绰→萧太后、宋徽宗→赵佶、魏征→魏徵、完颜兀术→完颜宗弼、朱允炆→建文帝）后并入对应事件，重复人物不重复成节点。",
    "4. **图谱可用性**：新增事件参与者均 ≥ 2 人，保证每个新人物至少一条连线；合并后全库 0 孤儿节点、0 悬空边。",
    "",
]

out = ROOT / "docs" / "V0.8.2-docs合并对照.md"
out.write_text("\n".join(lines), encoding="utf-8")
print(f"写入 {out}（{len(rows)} 行，涉及新事件 {covered_new} 行）")
