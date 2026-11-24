# -*- coding: utf-8 -*-
import json, os
TMP = r"C:\Users\wiledog\Desktop\历史\.tmp"
events = json.load(open(os.path.join(TMP, "shiji_events.json"), encoding="utf-8"))
rows = json.load(open(os.path.join(TMP, "final_136.json"), encoding="utf-8"))
by_id = {e["event_id"]: e for e in events}
for eid in ["085-010", "085-011", "085-012", "014-008", "074-010", "029-006", "063-005",
            "074-001", "072-007", "046-015", "041-013", "035-003", "013-027", "029-008"]:
    e = by_id.get(eid)
    if not e:
        print(eid, "MISSING"); continue
    print(f"### {eid} | {e['event_name']} | {e['time']} | year={e['year']} | prec={e.get('precision')}")
    print("   desc:", (e.get("description") or "")[:260])
    print("   note:", (e.get("date_note") or "")[:160])
    print()

# 检查同年/近年的重复风险：战国 嫪毐 / 吕不韦 / 荀子
for e in events:
    if e["chapter"][:3] == "085" and e["year"] and e["year"] > -245:
        print(f"085 {e['year']} | {e['event_name']} | {e.get('type')} | {e['time']}")
