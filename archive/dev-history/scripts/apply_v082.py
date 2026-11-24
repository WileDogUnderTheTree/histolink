# -*- coding: utf-8 -*-
"""V0.8.2 数据合并：把新事件 / 参与者 / 关系写入前端数据文件，并更新图谱分期事件池。

只做机械写入，不做史实判断；所有数据来自 .tmp/v082/new_events_*.json。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "frontend" / "data"
TMP = Path(__file__).parent

FILES = [
    "new_events_song.json",
    "new_events_liao_xixia_jin.json",
    "new_events_yuan.json",
    "new_events_ming_qing.json",
    "new_events_others.json",
]

# 既有事件 / 参与者 / 关系，用于去重和校验。
old_events = json.loads((TMP / "data.json").read_text(encoding="utf-8"))
old_ids = {e["id"] for e in old_events["events"]}
old_pairs = {"__".join(sorted((r["a"], r["b"]))) for r in old_events["relations"]}
old_relations = {"__".join(sorted((r["a"], r["b"]))): r for r in old_events["relations"]}

new_events = []
for name in FILES:
    payload = json.loads((TMP / name).read_text(encoding="utf-8"))
    new_events.extend(payload["events"])

# ---------- 校验 ----------
seen = set()
for event in new_events:
    assert event["id"] not in old_ids, f"id 与既有事件冲突：{event['id']}"
    assert event["id"] not in seen, f"新事件 id 重复：{event['id']}"
    seen.add(event["id"])
    assert event["year"] != 0, f"年份 0 非法：{event['id']}"
    assert len(event["participants"]) >= 2, f"参与者少于 2 人（会成孤儿节点）：{event['id']}"
    assert "（据《" in event["description"], f"缺少出处括注：{event['id']}"
    assert 20 <= len(event["description"]) <= 120, f"简述长度异常：{event['id']} ({len(event['description'])})"

# ---------- 1. 写入 timeline-events.ts ----------
GROUP_ORDER = ["西汉", "南北朝", "隋", "唐", "五代十国", "北宋", "南宋", "辽", "西夏", "金", "元", "明", "清"]
GROUP_LABEL = {d: d for d in GROUP_ORDER}

def event_ts(event):
    lines = [
        "  {",
        f'    id: "{event["id"]}",',
        f'    title: "{event["title"]}",',
        f'    dynasty: "{event["dynasty"]}",',
        f'    year: {event["year"]},',
    ]
    if event.get("importance"):
        lines.append(f'    importance: {event["importance"]},')
    lines.append("    description:")
    lines.append(f'      "{event["description"]}",')
    lines.append("  },")
    return "\n".join(lines)

groups = {}
for event in new_events:
    groups.setdefault(event["dynasty"], []).append(event)

blocks = []
for dynasty in GROUP_ORDER:
    items = groups.get(dynasty, [])
    if not items:
        continue
    blocks.append(f"\n  // ===== V0.8.2 厚度对齐：{dynasty}（+{len(items)} 条）=====")
    blocks.extend(event_ts(event) for event in items)
other = [e for e in new_events if e["dynasty"] not in GROUP_ORDER]
assert not other, f"未归组的朝代：{[e['dynasty'] for e in other]}"

timeline_path = DATA / "timeline-events.ts"
text = timeline_path.read_text(encoding="utf-8")
marker = "\n];\n\n/** 所有对外事件均具备 participants"
pos = text.rfind(marker)
assert pos != -1
text = text[:pos] + "\n" + "\n".join(blocks) + text[pos:]
timeline_path.write_text(text, encoding="utf-8")

# ---------- 2. 写入 timeline-participants.ts ----------
participants_path = DATA / "timeline-participants.ts"
ptext = participants_path.read_text(encoding="utf-8")

# 2a. 既有事件的参与者补充（补孤儿节点连线 + docs 合并的参与者并入）。
overrides = json.loads((TMP / "participant_overrides.json").read_text(encoding="utf-8"))
for event_id, extra in overrides.items():
    pattern = re.compile(r'^(  "' + re.escape(event_id) + r'": )\[(.*?)\],$', re.MULTILINE)
    match = pattern.search(ptext)
    assert match, f"未找到既有参与者行：{event_id}"
    current = [x.strip().strip('"') for x in match.group(2).split(",") if x.strip()]
    merged = current + [x for x in extra if x not in current]
    rendered = ", ".join(f'"{x}"' for x in merged)
    ptext = ptext[: match.start()] + match.group(1) + "[" + rendered + "]," + ptext[match.end():]

new_participant_lines = []
for dynasty in GROUP_ORDER:
    items = groups.get(dynasty, [])
    if not items:
        continue
    new_participant_lines.append(f"\n  // ===== V0.8.2 厚度对齐：{dynasty}（+{len(items)} 条）=====")
    for event in items:
        rendered = ", ".join(f'"{p}"' for p in event["participants"])
        new_participant_lines.append(f'  "{event["id"]}": [{rendered}],')
ppos = ptext.rfind("\n};\n")
assert ppos != -1
ptext = ptext[:ppos] + "\n" + "\n".join(new_participant_lines) + ptext[ppos:]
participants_path.write_text(ptext, encoding="utf-8")

# ---------- 3. 写入 person-relations.ts ----------
merged = {}
for event in new_events:
    for rel in event.get("relations", []):
        a, b = rel["a"], rel["b"]
        assert a != b, f"关系两端相同：{event['id']}"
        assert a in event["participants"] and b in event["participants"], (
            f"关系人物未共同参与该事件：{event['id']} {a}×{b}"
        )
        key = "__".join(sorted((a, b)))
        if key in old_pairs:
            existing = old_relations[key]
            if event["id"] not in existing["eventSummaries"]:
                # 既有关系补一条事件简述（不改既有定性）。
                merged.setdefault(key, {"merge": True, "eventId": event["id"], "summary": rel["summary"]})
            continue
        if key not in merged:
            merged[key] = {
                "merge": False,
                "a": a,
                "b": b,
                "label": rel["label"],
                "description": rel.get("description", ""),
                "summaries": {},
            }
        entry = merged[key]
        if entry.get("merge"):
            continue
        if event["id"] not in entry["summaries"]:
            entry["summaries"][event["id"]] = rel["summary"]
        if not entry["description"] and rel.get("description"):
            entry["description"] = rel["description"]

relations_path = DATA / "person-relations.ts"
rtext = relations_path.read_text(encoding="utf-8")

merged_new = {k: v for k, v in merged.items() if not v.get("merge")}
merged_patch = {k: v for k, v in merged.items() if v.get("merge")}

# 3a. 既有关系补事件简述。
for key, patch in merged_patch.items():
    a, b = key.split("__")
    # 定位 a/b 顺序可能相反的记录块，在该记录的 eventSummaries 末尾插入。
    pattern = re.compile(
        r'(\{\n    a: "' + re.escape(a) + r'",\n    b: "' + re.escape(b) + r'",.*?eventSummaries: \{\n)(.*?)(\n    \},\n  \},)',
        re.DOTALL,
    )
    match = pattern.search(rtext)
    if not match:
        pattern = re.compile(
            r'(\{\n    a: "' + re.escape(b) + r'",\n    b: "' + re.escape(a) + r'",.*?eventSummaries: \{\n)(.*?)(\n    \},\n  \},)',
            re.DOTALL,
        )
        match = pattern.search(rtext)
    assert match, f"未找到既有关系记录：{key}"
    line = f'\n      "{patch["eventId"]}": "{patch["summary"]}",'
    rtext = rtext[: match.end(2)] + line + rtext[match.end(2):]

def relation_ts(entry):
    lines = ["  {", f'    a: "{entry["a"]}",', f'    b: "{entry["b"]}",', f'    label: "{entry["label"]}",']
    if entry["description"]:
        lines.append(f'    description: "{entry["description"]}",')
    lines.append("    eventSummaries: {")
    for event_id, summary in entry["summaries"].items():
        lines.append(f'      "{event_id}": "{summary}",')
    lines.append("    },")
    lines.append("  },")
    return "\n".join(lines)

rel_block = ["\n  // ===== V0.8.2 厚度对齐：新增人物关系（按事件去重合并）====="]
rel_block.extend(relation_ts(entry) for entry in merged_new.values())
marker = "\n];\n\nconst relationIndex"
rpos = rtext.rfind(marker)
assert rpos != -1
rtext = rtext[:rpos] + "\n" + "\n".join(rel_block) + rtext[rpos:]
relations_path.write_text(rtext, encoding="utf-8")

print(f"新事件 {len(new_events)} 条；新增关系 {len(merged_new)} 对；既有关系补简述 {len(merged_patch)} 条。")
print("按朝代：", {d: len(groups.get(d, [])) for d in GROUP_ORDER})
