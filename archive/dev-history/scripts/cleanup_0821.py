# -*- coding: utf-8 -*-
"""V0.8.2.1 附加清洗：去掉「人物晚于卒年 / 跨期」参与事件的硬伤，修正自撰事件年份。

- 既有事件参与者清洗（只动 V0.8.2.1 明确排查出的跨期人物）；
- 关系库同步：把关系简述挪到两人仍共同参与的事件，删除已无共同事件的关系；
- 修正 V0.8.2 自撰事件的纪年笔误（id 与 year 对既有条目只增不改，新条目允许校正）。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "frontend" / "data"
TMP = Path(__file__).parent
data = json.loads((TMP / "data.json").read_text(encoding="utf-8"))
event_by_id = {event["id"]: event for event in data["events"]}

# 既有事件：参与者清洗（去掉卒于事件之前的人物，并补入真实参与者）。
PARTICIPANT_OVERRIDES = {
    "beisong-01": ["赵匡胤", "赵普", "赵光义", "石守信", "周恭帝"],
    "liao-03": ["耶律德光", "后晋出帝"],
    "jin-01": ["辽天祚帝", "完颜娄室"],
    "yuan-04": ["窝阔台", "金哀宗"],
    "yuan-06": ["忽必烈", "刘秉忠"],
    "ming-04": ["朱棣", "建文帝"],
    "qing-02": ["皇太极", "范文程"],
    "qing-04": ["多尔衮", "李自成", "吴三桂"],
    "wudai-04": ["李存勖", "后梁末帝"],
}

# V0.8.2 自撰事件：年份笔误校正。
YEAR_FIXES = {
    "wudai-24": 912,   # 朱友珪弑父发生于 912，不是 919
    "beisong-22": 1052,  # 包拯权知开封府
    "jin-07": 1127,    # 张邦昌伪楚
    "jin-10": 1208,    # 金章宗崩、卫绍王立
    "jin-14": 1224,    # 金哀宗即位
    "ming-37": 1600,   # 播州之役平定
    "qing-34": 1724,   # 平定罗卜藏丹津
    "yuan-26": 1285,   # 杨琏真迦盗宋陵
    "liao-10": 969,    # 辽穆宗遇弑
    "sui-21": 595,     # 仁寿宫建成
    "tang-50": 756,    # 马嵬驿之变
    "tang-49": 717,    # 遣唐使来朝（吉备真备、阿倍仲麻吕）
    "yuan-32": 1329,   # 奎章阁学士院设立
}

# 关系库：事件简述键迁移（原键 → 新键 + 新简述文本）。
RELATION_KEY_FIXES = {
    ("柴荣", "赵匡胤"): (
        "beisong-01",
        "wudai-17",
        "高平之战赵匡胤力战有功，柴荣擢之于行伍；柴荣崩后赵匡胤代周建宋。",
    ),
}
# 关系库：删除已无共同事件的事件简述键。
RELATION_KEY_REMOVALS = [
    ("耶律阿保机", "耶律德光", "liao-03"),
    ("完颜阿骨打", "辽天祚帝", "jin-01"),
    ("成吉思汗", "窝阔台", "yuan-04"),
    ("朱元璋", "朱棣", "ming-04"),
    ("努尔哈赤", "皇太极", "qing-02"),
    ("皇太极", "多尔衮", "qing-04"),
    ("朱温", "李存勖", "wudai-04"),
]
# 关系库：删除整条关系（人物已不再共同参与任何事件）。
RELATION_REMOVALS = [("成吉思汗", "忽必烈")]

# ---------- 1. timeline-participants.ts ----------
participants_path = DATA / "timeline-participants.ts"
ptext = participants_path.read_text(encoding="utf-8")
for event_id, people in PARTICIPANT_OVERRIDES.items():
    pattern = re.compile(r'^  "' + re.escape(event_id) + r'": \[.*?\],$', re.MULTILINE)
    assert len(pattern.findall(ptext)) == 1, f"参与者行匹配异常：{event_id}"
    rendered = ", ".join(f'"{p}"' for p in people)
    ptext = pattern.sub(f'  "{event_id}": [{rendered}],', ptext)
participants_path.write_text(ptext, encoding="utf-8")

# ---------- 2. timeline-events.ts 年份校正 ----------
events_path = DATA / "timeline-events.ts"
etext = events_path.read_text(encoding="utf-8")
for event_id, year in YEAR_FIXES.items():
    pattern = re.compile(
        r'(id: "' + re.escape(event_id) + r'",\n    title: "[^"]*",\n    dynasty: "[^"]*",\n    year: )-?\d+'
    )
    matches = pattern.findall(etext)
    assert len(matches) == 1, f"年份行匹配异常：{event_id}"
    etext = pattern.sub(lambda m: m.group(1) + str(year), etext)
events_path.write_text(etext, encoding="utf-8")

# ---------- 3. person-relations.ts ----------
relations_path = DATA / "person-relations.ts"
rtext = relations_path.read_text(encoding="utf-8")

for (a, b), (old_key, new_key, new_summary) in RELATION_KEY_FIXES.items():
    old_line = next(
        (
            f'      "{old_key}": "{summary}",\n'
            for summary in [event_by_id[old_key]["description"]]
            if False
        ),
        None,
    )
    # 从当前关系库里定位该关系的旧简述行（键 + 任意文本）。
    record_pattern = re.compile(
        r'(a: "' + re.escape(a) + r'",\n    b: "' + re.escape(b) + r'",[\s\S]*?)'
        r'      "' + re.escape(old_key) + r'": "[^"]*",\n'
    )
    match = record_pattern.search(rtext)
    if not match:
        record_pattern = re.compile(
            r'(a: "' + re.escape(b) + r'",\n    b: "' + re.escape(a) + r'",[\s\S]*?)'
            r'      "' + re.escape(old_key) + r'": "[^"]*",\n'
        )
        match = record_pattern.search(rtext)
    assert match, f"关系简述行未找到：{a}×{b} / {old_key}"
    replacement = match.group(1) + f'      "{new_key}": "{new_summary}",\n'
    rtext = rtext[: match.start()] + replacement + rtext[match.end():]

for a, b, event_id in RELATION_KEY_REMOVALS:
    pattern = re.compile(
        r'(a: "' + re.escape(a) + r'",\n    b: "' + re.escape(b) + r'",[\s\S]*?)'
        r'      "' + re.escape(event_id) + r'": "[^"]*",\n'
    )
    match = pattern.search(rtext)
    if not match:
        pattern = re.compile(
            r'(a: "' + re.escape(b) + r'",\n    b: "' + re.escape(a) + r'",[\s\S]*?)'
            r'      "' + re.escape(event_id) + r'": "[^"]*",\n'
        )
        match = pattern.search(rtext)
    assert match, f"关系简述行未找到：{a}×{b} / {event_id}"
    rtext = rtext[: match.start()] + match.group(1) + rtext[match.end():]

for a, b in RELATION_REMOVALS:
    for x, y in ((a, b), (b, a)):
        pattern = re.compile(
            r'\n  \{\n    a: "' + re.escape(x) + r'",\n    b: "' + re.escape(y) + r'",\n(?:.*\n)*?  \},\n'
        )
        if pattern.search(rtext):
            rtext = pattern.sub("\n", rtext, count=1)
            break
    else:
        raise SystemExit(f"整条关系未找到：{a}×{b}")
relations_path.write_text(rtext, encoding="utf-8")

print(f"参与者清洗 {len(PARTICIPANT_OVERRIDES)} 条；年份校正 {len(YEAR_FIXES)} 条；"
      f"关系简述迁移 {len(RELATION_KEY_FIXES)} 条、删除简述 {len(RELATION_KEY_REMOVALS)} 条、"
      f"删除关系 {len(RELATION_REMOVALS)} 对。")
