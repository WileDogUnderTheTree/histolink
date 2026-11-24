# -*- coding: utf-8 -*-
"""Step 6: stats + sample card text for the 136 curated events."""
import json, os, re, collections

TMP = r"C:\Users\wiledog\Desktop\历史\.tmp"
rows = json.load(open(os.path.join(TMP, "final_136.json"), encoding="utf-8"))

def clean(s):
    s = re.sub(r"〖[@=;&%~+!?]?", "", s or "")
    s = s.replace("〗", "").replace("〖", "")
    s = re.sub(r"\s+", "", s)
    return s

print("total:", len(rows))
print("precision:", dict(collections.Counter(r["precision"] for r in rows)))
print("chapters:", dict(collections.Counter(r["chapter"].split("_")[1] for r in rows)))
retitled = [(r["dynasty"], r["year"], r["source_name"], r["title"]) for r in rows if r["source_name"] != r["title"]]
print("retitled:", len(retitled))
for x in retitled:
    print("   ", x)
print("\n--- 样例卡片（清洗后描述前 90 字）---")
samples = [r for r in rows if r["event_id"] in ("002-025", "013-027", "004-026", "039-022", "073-009", "014-009")]
for r in samples:
    d = clean(r["description"])
    print(f"[{r['dynasty']} · {'前'+str(-r['year']) if r['year']<0 else r['year']}] {r['title']}")
    print("   ", d[:110])
    print("   出处:", r["chapter"].split("_")[1], "| 原文:", clean(r["quote"])[:40])
