# -*- coding: utf-8 -*-
"""V0.8.2.1：同步 README 的分图表 / 关系覆盖 / 关系库数量（跨期清洗后）。"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
data = json.loads((ROOT / ".tmp" / "v082" / "data.json").read_text(encoding="utf-8"))
stats = {}
for group in data["eras"] + data["scopes"]:
    covered = sum(1 for edge in group["edges"] if edge["hasRelation"])
    stats[group["label"]] = (len(group["nodes"]), len(group["edges"]), covered)
relation_total = len(data["relations"])
covered_total = sum(1 for group in data["eras"] + data["scopes"] for edge in group["edges"] if edge["hasRelation"])
node_slots = sum(len(group["nodes"]) for group in data["eras"] + data["scopes"])
edge_total = sum(len(group["edges"]) for group in data["eras"] + data["scopes"])
unique_pairs = len({edge["id"] for group in data["eras"] + data["scopes"] for edge in group["edges"]})

path = ROOT / "README.md"
text = path.read_text(encoding="utf-8")

# ---------- 分图表：按标签重建每一行 ----------
for label, (nodes, edges, covered) in stats.items():
    # 细览行形如 | 秦汉 | 覆盖朝代 | 183 | 368 | 刘邦 | 细览 + 简阅 |
    pattern = re.compile(
        r"^\| " + re.escape(label) + r" \| ([^|]+?) \| \d+ \| \d+ \| ([^|]+?) \| ([^|]+?) \|$",
        re.MULTILINE,
    )
    text, count = pattern.subn(
        lambda m: f"| {label} | {m.group(1).strip()} | {nodes} | {edges} | {m.group(2).strip()} | {m.group(3).strip()} |",
        text,
    )
    assert count == 1, f"分图表行匹配异常：{label} ({count})"

# ---------- 关系覆盖 summary 段落：整段替换 ----------
coverage_order = [
    ("北宋", "beisong"), ("辽", "liao"), ("金", "jin"), ("元", "yuan"),
    ("明", "ming"), ("清", "qing"), ("五代十国", "wudai"),
]
parts = []
for label, _ in coverage_order:
    nodes, edges, covered = stats[label]
    parts.append(f"{label} {covered}/{edges}")
scope_parts = []
for label in ["先秦", "魏晋南北朝", "隋唐", "宋辽金夏", "元明清"]:
    nodes, edges, covered = stats[label]
    scope_parts.append(f"{label} {covered}/{edges}")
new_bullet = (
    f"- **两人关系**（`person-relations.ts`）：按人物对校订关系定性（对手 / 君臣 / 盟友 / 政敌 …）与逐事件简述；"
    f"当前 **{relation_total} 对**（V0.8.2 新增 179 对随 174 条新事件同步校订；V0.8.2.1 清理 1 条无共同事件的"
    f"「成吉思汗 × 忽必烈」后为 {relation_total} 对）。关系随边归属：三国图 176/179 近全覆盖，秦汉图 27/368（楚汉关系为主，"
    f"汉末关系已随边移入三国图）；当前各期覆盖：" + "、".join(parts) +
    "；简阅" + "、".join(scope_parts) + "；未覆盖边回退事件正文摘要（与春秋战国口径一致）。"
)
text = re.sub(r"^- \*\*两人关系\*\*（`person-relations\.ts`）.*$", new_bullet, text, count=1, flags=re.MULTILINE)

# ---------- 快照关系数 / 已知限制 ----------
text = text.replace("670 条事件 · 23 个朝代/时期 · 640 对人物关系", f"670 条事件 · 23 个朝代/时期 · {relation_total} 对人物关系")
text = re.sub(
    r"- \*\*两人关系数据\*\*目前覆盖 \*\*\d+ 对\*\*，覆盖 25 张图谱中的 \d+ 条边；",
    f"- **两人关系数据**目前覆盖 **{relation_total} 对**，覆盖 25 张图谱中的 {covered_total} 条边；",
    text,
    count=1,
)

# ---------- V0.8.2.1 近期日志：补跨期清洗条目 ----------
text = text.replace(
    "- **全分期排查**：补正南宋 / 辽 / 金 / 元四期 `dynasties` 声明与实际事件池一致（北宋、金、南宋互见），新增「分期隔离」校验：节点必须锚定当期声明朝代、秦汉 ≤184、三国 ≥188、三国人物不得进入秦汉图，反之亦然。",
    "- **全分期排查**：补正南宋 / 辽 / 金 / 元四期 `dynasties` 声明与实际事件池一致（北宋、金、南宋互见），新增「分期隔离」校验：节点必须锚定当期声明朝代、秦汉 ≤184、三国 ≥188、三国人物不得进入秦汉图，反之亦然。\n"
    "- **跨期人物清洗**：清理 9 条既有事件中「晚于卒年仍参与」的跨期人物（陈桥兵变去柴荣、灭后晋去耶律阿保机、金灭辽去完颜阿骨打、蒙古灭金 / 建元去成吉思汗、靖难去朱元璋、改国号去努尔哈赤、清军入关去皇太极补吴三桂、灭后梁去朱温），并校正 13 条 V0.8.2 自撰事件的纪年笔误；关系库 640 → **639 对**。",
)

path.write_text(text, encoding="utf-8")
print(f"README 同步完成：关系库 {relation_total} 对 / 覆盖边 {covered_total} / 图谱节点位 {node_slots} / 边 {edge_total} / 去重对 {unique_pairs}")
