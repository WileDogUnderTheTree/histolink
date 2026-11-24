# -*- coding: utf-8 -*-
"""Step 3: filtered candidate lists for 春秋/战国 (drop low-signal types), plus keyword search."""
import json, os, re, sys

TMP = r"C:\Users\wiledog\Desktop\历史\.tmp"
events = json.load(open(os.path.join(TMP, "shiji_events.json"), encoding="utf-8"))

def dynasty_of(e):
    y, ch = e.get("year"), e.get("chapter", "")[:3]
    if y is None: return None
    if ch == "002" and -2100 <= y <= -1601: return "夏"
    if -2070 <= y <= -1601: return "夏"
    if -1600 <= y <= -1047: return "商"
    if -1046 <= y <= -771: return "西周"
    if -770 <= y <= -476: return "春秋"
    if -475 <= y <= -222: return "战国"
    return None

for e in events:
    e["dynasty"] = dynasty_of(e)

def norm(s):
    s = re.sub(r"[（(].*?[）)]", "", s or "")
    s = re.sub(r"[\s·・，。、：:；;“”‘’《》]", "", s)
    return s

DROP = {"继位", "家族事件", "人物死亡", "自然灾害"}
FILES = {"春秋": "cand_4_chunqiu.txt", "战国": "cand_5_zhanguo.txt"}

for d, fn in FILES.items():
    sub = [e for e in events if e["dynasty"] == d]
    seen = {}
    for e in sub:
        key = (e["year"], norm(e["event_name"]))
        if key in seen:
            seen[key].append(e)
        else:
            seen[key] = [e]
    uniq = []
    for key, group in seen.items():
        group.sort(key=lambda x: -len(x.get("description") or ""))
        uniq.append(group[0])
    kept = [e for e in uniq if e.get("type") not in DROP]
    kept.sort(key=lambda e: (e["year"], e["event_name"]))
    lines = []
    for e in kept:
        lines.append(f"{e['year']:>6} | {e['event_name']:<16s} | {e.get('type',''):<4s} | {e['chapter'][:3]}")
    with open(os.path.join(TMP, fn), "w", encoding="utf-8") as f:
        f.write(f"# {d} 去重 {len(uniq)} / 过滤后 {len(kept)}\n" + "\n".join(lines) + "\n")
    print(d, "uniq", len(uniq), "kept", len(kept))

# keyword search helper
def search(keys, dynasty=None, limit=8):
    out = []
    for e in events:
        if dynasty and e["dynasty"] != dynasty: continue
        n = e["event_name"] or ""
        if any(k in n for k in keys):
            out.append(e)
    out.sort(key=lambda e: (e["year"] or 9999, e["event_name"]))
    for e in out[:limit]:
        print(f"  {e['year']} | {e['event_name']} | {e.get('type')} | {e['chapter'][:3]} | {(e.get('description') or '')[:50]}")
    if len(out) > limit: print(f"  ... {len(out)-limit} more")
    return out

if __name__ == "__main__":
    pass
