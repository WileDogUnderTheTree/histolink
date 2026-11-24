# -*- coding: utf-8 -*-
"""docs/01_先秦.md — docs/06_元明清.md 与现有事件的语义映射 + 参与者去重合并。

输出：
- 往 .tmp/v082/participant_overrides.json 追加「既有事件」的参与者并集；
- 直接改写 .tmp/v082/new_events_*.json 中「新增事件」的参与者并集；
- 打印覆盖报告，确保 124 行 docs 事件全部落到某个事件上（同题去重，不重复录入）。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TMP = Path(__file__).parent
DOCS = ROOT / "docs"
NEW_FILES = [
    "new_events_song.json",
    "new_events_liao_xixia_jin.json",
    "new_events_yuan.json",
    "new_events_ming_qing.json",
    "new_events_others.json",
]

# 文档人物名 → 事件库已用节点名（去重口径）。未列出的原样保留。
NORMALIZE = {
    "大禹": "禹", "桀": "夏桀", "勾践": "越王勾践", "夫差": "吴王夫差",
    "成得臣": "子玉", "嬴政": "秦始皇", "召公": "召穆公", "周公": "周定公",
    "拓跋宏(元宏)": "孝文帝", "魏征": "魏徵",
    "宋真宗": "赵恒", "宋仁宗": "赵祯", "宋神宗": "赵顼", "宋徽宗": "赵佶",
    "宋钦宗": "赵桓", "宋高宗": "赵构", "宋孝宗": "赵昚", "宋理宗": "赵昀",
    "萧绰": "萧太后", "完颜兀术": "完颜宗弼",
    "唐德宗": "李适", "唐宪宗": "李纯",
    "明神宗": "万历帝", "朱允炆": "建文帝",
}
# 不参与参与者并集的泛称 / 无法唯一对应的人物。
SKIP = {"召公", "周公", "成得臣"}

# (文档文件, 文档事件名) → [事件 id] 或 {事件 id: [该事件应并入的人物]}
MAP = {
    # ---------- 01 先秦 ----------
    ("01_先秦.md", "夏朝建立"): ["xia-04"],
    ("01_先秦.md", "少康中兴"): ["xia-09"],
    ("01_先秦.md", "鸣条之战"): ["xia-13"],
    ("01_先秦.md", "盘庚迁殷"): ["shang-07"],
    ("01_先秦.md", "武丁中兴"): ["shang-08"],
    ("01_先秦.md", "牧野之战"): ["xizhou-01"],
    ("01_先秦.md", "周公东征"): ["xizhou-05"],
    ("01_先秦.md", "成康之治"): ["xizhou-06"],
    ("01_先秦.md", "国人暴动·共和行政"): ["xizhou-17"],
    ("01_先秦.md", "犬戎攻镐京"): ["xizhou-22"],
    ("01_先秦.md", "平王东迁"): ["chunqiu-01"],
    ("01_先秦.md", "葵丘之会"): ["chunqiu-09"],
    ("01_先秦.md", "城濮之战"): ["chunqiu-14"],
    ("01_先秦.md", "楚庄王问鼎"): ["chunqiu-19"],
    ("01_先秦.md", "勾践灭吴"): ["zhanguo-01"],
    ("01_先秦.md", "三家分晋"): ["zhanguo-02"],
    ("01_先秦.md", "商鞅变法"): ["zhanguo-05"],
    ("01_先秦.md", "胡服骑射"): ["zhanguo-21"],
    ("01_先秦.md", "长平之战"): ["zhanguo-31"],
    ("01_先秦.md", "秦灭六国"): ["qin-unify"],
    # ---------- 02 秦汉 ----------
    ("02_秦汉.md", "秦始皇确立帝制"): ["qin-emperor-title"],
    ("02_秦汉.md", "蒙恬北击匈奴筑长城"): ["qin-xiongnu"],
    ("02_秦汉.md", "焚书坑儒"): ["qin-book-burning"],
    ("02_秦汉.md", "沙丘之变"): ["qin-shafu-coup"],
    ("02_秦汉.md", "大泽乡起义"): ["qin-daze-uprising"],
    ("02_秦汉.md", "巨鹿之战"): ["qin-julu-battle"],
    ("02_秦汉.md", "垓下之战"): ["xihan-gaixia"],
    ("02_秦汉.md", "西汉建立"): ["han-founded"],
    ("02_秦汉.md", "白登之围"): ["xihan-baideng"],
    ("02_秦汉.md", "文景之治"): ["xihan-wenjing"],
    ("02_秦汉.md", "七国之乱"): ["han-seven-states"],
    ("02_秦汉.md", "罢黜百家独尊儒术"): ["xihan-confucianism"],
    ("02_秦汉.md", "推恩令"): ["xihan-tuien"],
    ("02_秦汉.md", "张骞通西域"): ["han-zhang-qian"],
    ("02_秦汉.md", "漠北之战"): ["xihan-mobei"],
    ("02_秦汉.md", "王莽篡汉"): ["han-wang-mang"],
    ("02_秦汉.md", "光武中兴"): ["handong-founded"],
    ("02_秦汉.md", "班超通西域"): ["handong-banchao-start"],
    ("02_秦汉.md", "蔡伦改进造纸术"): ["han-cai-lun"],
    ("02_秦汉.md", "党锢之祸"): ["handong-danggu-1"],
    ("02_秦汉.md", "黄巾起义"): ["han-yellow-turban"],
    ("02_秦汉.md", "官渡之战"): ["handong-guandu"],
    # ---------- 03 魏晋南北朝 ----------
    ("03_魏晋南北朝.md", "曹丕代汉建魏"): ["handong-han-fall"],
    ("03_魏晋南北朝.md", "刘备称帝建蜀汉"): ["sanguo-01"],
    ("03_魏晋南北朝.md", "夷陵之战"): ["sanguo-02"],
    ("03_魏晋南北朝.md", "诸葛亮北伐"): ["sanguo-07"],
    ("03_魏晋南北朝.md", "孙权称帝建吴"): ["sanguo-06"],
    ("03_魏晋南北朝.md", "司马炎代魏建晋"): ["xijin-01"],
    ("03_魏晋南北朝.md", "西晋灭吴统一"): ["xijin-02"],
    ("03_魏晋南北朝.md", "八王之乱"): ["xijin-04"],
    ("03_魏晋南北朝.md", "永嘉之乱"): ["xijin-06"],
    ("03_魏晋南北朝.md", "东晋建立·衣冠南渡"): ["dongjin-01"],
    ("03_魏晋南北朝.md", "淝水之战"): ["dongjin-07"],
    ("03_魏晋南北朝.md", "刘裕代晋建宋"): ["nanbeichao-01"],
    ("03_魏晋南北朝.md", "萧道成代宋建齐"): ["nanbeichao-13"],
    ("03_魏晋南北朝.md", "萧衍代齐建梁"): ["nanbeichao-14"],
    ("03_魏晋南北朝.md", "侯景之乱"): ["nanbeichao-08"],
    ("03_魏晋南北朝.md", "陈霸先代梁建陈"): ["nanbeichao-15"],
    ("03_魏晋南北朝.md", "北魏统一北方"): ["nanbeichao-02"],
    ("03_魏晋南北朝.md", "孝文帝改革"): ["nanbeichao-03"],
    ("03_魏晋南北朝.md", "北魏分裂"): ["nanbeichao-07"],
    ("03_魏晋南北朝.md", "北周灭北齐"): ["nanbeichao-10"],
    # ---------- 04 隋唐 ----------
    ("04_隋唐.md", "杨坚代周建隋"): ["sui-10"],
    ("04_隋唐.md", "隋灭陈统一"): ["sui-02"],
    ("04_隋唐.md", "开皇之治"): ["sui-01"],
    ("04_隋唐.md", "大运河开凿"): ["sui-13"],
    ("04_隋唐.md", "隋末农民起义"): ["sui-15"],
    ("04_隋唐.md", "李渊建唐"): ["tang-01"],
    ("04_隋唐.md", "玄武门之变"): ["tang-04"],
    ("04_隋唐.md", "贞观之治"): ["tang-05"],
    ("04_隋唐.md", "文成公主入藏"): ["tang-29"],
    ("04_隋唐.md", "武则天称帝"): ["tang-09"],
    ("04_隋唐.md", "开元盛世"): ["tang-13"],
    ("04_隋唐.md", "安史之乱"): ["tang-17"],
    ("04_隋唐.md", "两税法改革"): ["tang-36"],
    ("04_隋唐.md", "元和中兴"): ["tang-38"],
    ("04_隋唐.md", "黄巢起义"): ["tang-44"],
    ("04_隋唐.md", "朱温代唐建梁"): ["wudai-01"],
    ("04_隋唐.md", "李存勖灭梁建后唐"): ["wudai-04"],
    ("04_隋唐.md", "石敬瑭割燕云十六州"): ["wudai-08"],
    ("04_隋唐.md", "郭威建后周"): ["wudai-09"],
    ("04_隋唐.md", "柴荣改革"): ["wudai-18"],
    # ---------- 05 宋辽夏金 ----------
    ("05_宋辽夏金.md", "陈桥兵变·北宋建立"): ["beisong-01"],
    ("05_宋辽夏金.md", "杯酒释兵权"): ["beisong-02"],
    ("05_宋辽夏金.md", "澶渊之盟"): ["beisong-06"],
    ("05_宋辽夏金.md", "庆历新政"): ["beisong-07"],
    ("05_宋辽夏金.md", "王安石变法"): ["beisong-10"],
    ("05_宋辽夏金.md", "靖康之变"): ["beisong-34"],
    ("05_宋辽夏金.md", "南宋建立"): ["nansong-09"],
    ("05_宋辽夏金.md", "岳飞抗金"): ["nansong-14"],
    ("05_宋辽夏金.md", "绍兴和议"): ["nansong-04"],
    ("05_宋辽夏金.md", "隆兴和议"): ["nansong-16"],
    ("05_宋辽夏金.md", "开禧北伐"): ["nansong-07"],
    ("05_宋辽夏金.md", "联蒙灭金"): ["nansong-21"],
    ("05_宋辽夏金.md", "崖山之战"): ["nansong-08"],
    ("05_宋辽夏金.md", "耶律阿保机建契丹"): ["liao-01"],
    ("05_宋辽夏金.md", "辽灭后晋"): ["liao-03"],
    ("05_宋辽夏金.md", "李元昊建西夏"): ["xixia-01"],
    ("05_宋辽夏金.md", "宋夏战争"): ["xixia-02"],
    ("05_宋辽夏金.md", "完颜阿骨打建金"): ["jin-04"],
    ("05_宋辽夏金.md", "金灭辽"): ["jin-01"],
    ("05_宋辽夏金.md", "海陵王迁都燕京"): ["jin-05"],
    # ---------- 06 元明清 ----------
    ("06_元明清.md", "忽必烈建元"): ["yuan-06"],
    ("06_元明清.md", "郭守敬修《授时历》"): ["yuan-21"],
    ("06_元明清.md", "红巾军起义"): ["yuan-35"],
    ("06_元明清.md", "徐达北伐·元亡"): ["ming-21"],
    ("06_元明清.md", "朱元璋建明"): ["ming-02"],
    ("06_元明清.md", "靖难之役"): ["ming-04"],
    ("06_元明清.md", "郑和下西洋"): ["ming-05"],
    ("06_元明清.md", "土木堡之变·北京保卫战"): {
        "ming-28": ["明英宗", "王振"],
        "ming-29": ["于谦"],
    },
    ("06_元明清.md", "张居正改革"): ["ming-14"],
    ("06_元明清.md", "万历三大征"): ["ming-36"],
    ("06_元明清.md", "萨尔浒之战"): ["ming-38"],
    ("06_元明清.md", "李自成入京·明亡"): ["ming-17"],
    ("06_元明清.md", "清军入关"): ["qing-04"],
    ("06_元明清.md", "康熙平三藩"): ["qing-07"],
    ("06_元明清.md", "收复台湾"): ["qing-27"],
    ("06_元明清.md", "雅克萨之战·尼布楚条约"): {
        "qing-28": ["康熙帝"],
        "qing-29": ["康熙帝"],
    },
    ("06_元明清.md", "鸦片战争"): ["qing-13"],
    ("06_元明清.md", "太平天国运动"): ["qing-14"],
    ("06_元明清.md", "甲午战争"): ["qing-42"],
    ("06_元明清.md", "辛亥革命"): ["qing-44"],
}

DOC_FILES = ["01_先秦.md", "02_秦汉.md", "03_魏晋南北朝.md", "04_隋唐.md", "05_宋辽夏金.md", "06_元明清.md"]


def normalize(name):
    name = name.strip()
    if name in SKIP:
        return None
    return NORMALIZE.get(name, name)


def parse_docs():
    rows = []
    for fname in DOC_FILES:
        text = (DOCS / fname).read_text(encoding="utf-8")
        for line in text.splitlines():
            if not line.strip().startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 5 or cells[0] in ("所属朝代",) or set(cells[0]) <= {"-", ":", " "}:
                continue
            rows.append((fname, cells[0], cells[2], [c for c in cells[3].split(",") if c.strip()]))
    return rows


def main():
    rows = parse_docs()
    assert len(rows) == 122, f"docs 行数异常：{len(rows)}"

    overrides = json.loads((TMP / "participant_overrides.json").read_text(encoding="utf-8"))
    new_payloads = {name: json.loads((TMP / name).read_text(encoding="utf-8")) for name in NEW_FILES}
    new_events = {e["id"]: e for payload in new_payloads.values() for e in payload["events"]}

    covered = 0
    missed = []
    for fname, dynasty, title, people in rows:
        key = (fname, title)
        if key not in MAP:
            missed.append((fname, title))
            continue
        target = MAP[key]
        if isinstance(target, list):
            target = {event_id: [normalize(p) for p in people] for event_id in target}
        for event_id, names in target.items():
            names = [normalize(p) for p in names if p]
            names = [n for n in names if n]
            if event_id in new_events:
                current = new_events[event_id]["participants"]
                for n in names:
                    if n not in current:
                        current.append(n)
            else:
                current = overrides.get(event_id, [])
                for n in names:
                    if n not in current:
                        current.append(n)
                overrides[event_id] = current
        covered += 1

    if missed:
        for item in missed:
            print("MISS", item)
        raise SystemExit(f"有 {len(missed)} 行 docs 事件未映射")

    (TMP / "participant_overrides.json").write_text(
        json.dumps(overrides, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    for name, payload in new_payloads.items():
        (TMP / name).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"docs 行全部映射成功：{covered}/{len(rows)} 行（已去重合并到既有 / 新增事件）")
    print(f"既有事件参与者补充：{len(overrides)} 条")


if __name__ == "__main__":
    main()
