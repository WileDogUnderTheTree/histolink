# -*- coding: utf-8 -*-
"""Step 1: download batch-1 chapter event indexes from shiji-kb and parse to JSON."""
import json, os, re, sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = r"C:\Users\wiledog\Desktop\历史"
TMP = os.path.join(ROOT, ".tmp")
MDDIR = os.path.join(TMP, "shiji_md")
os.makedirs(MDDIR, exist_ok=True)

UA = {"User-Agent": "dsh-agent"}

def get(url, timeout=90):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")

CHAPTERS = [f"{i:03d}" for i in list(range(1, 6)) + [13, 14, 15, 29] + list(range(31, 48)) + list(range(61, 89))]
print("chapters:", len(CHAPTERS))

tree = json.loads(get("https://api.github.com/repos/baojie/shiji-kb/git/trees/main:kg/events/data"))["tree"]
all_paths = [t["path"] for t in tree if t["path"].endswith("_事件索引.md")]
targets = [p for p in all_paths if p[:3] in CHAPTERS]
print("target files:", len(targets), "missing:", sorted(set(CHAPTERS) - {p[:3] for p in targets}))

def fetch(path):
    dst = os.path.join(MDDIR, path)
    if os.path.exists(dst) and os.path.getsize(dst) > 500:
        return path, "cached"
    url = "https://raw.githubusercontent.com/baojie/shiji-kb/main/kg/events/data/" + urllib.parse.quote(path)
    raw = get(url).encode("utf-8")
    with open(dst, "wb") as f:
        f.write(raw)
    return path, len(raw)

with ThreadPoolExecutor(max_workers=8) as ex:
    for path, info in ex.map(fetch, targets):
        print(f"  {path:40s} {info}")

# ---------- parser (same rules as repo's export_events.py) ----------
DETAIL_FIELDS = {
    "事件类型": "type", "时间": "time", "地点": "location", "主要人物": "persons",
    "涉及朝代": "dynasties", "事件描述": "description", "原文引用": "source_text",
    "段落位置": "paragraph", "年代推断": "date_note",
}

def parse_overview(text):
    rows, in_sec, started, header = [], False, False, []
    for line in text.splitlines():
        if "## 事件列表概览" in line:
            in_sec = True; continue
        if not in_sec: continue
        s = line.strip()
        if not s:
            if started: break
            continue
        if re.match(r"^\|[-: |]+\|$", s): continue
        if s.startswith("|"):
            started = True
            cells = [c.strip() for c in s.strip("|").split("|")]
            if not header: header = cells
            else: rows.append(dict(zip(header, cells)))
        elif started: break
    return rows

def parse_details(text):
    details, in_det, cur_id, cur = {}, False, None, {}
    for line in text.splitlines():
        if "## 详细事件记录" in line:
            in_det = True; continue
        if not in_det: continue
        m = re.match(r"^### (\d{3}-\d{3})\s+(.*)", line)
        if m:
            if cur_id: details[cur_id] = cur
            cur_id, cur = m.group(1), {"event_id": m.group(1), "event_name": m.group(2).strip()}
            continue
        if cur_id is None: continue
        m = re.match(r"^-\s+\*\*(.+?)\*\*[：:]\s*(.*)", line)
        if m:
            k = m.group(1).strip()
            if k in DETAIL_FIELDS: cur[DETAIL_FIELDS[k]] = m.group(2).strip()
    if cur_id: details[cur_id] = cur
    return details

COL = {"事件ID": "event_id", "事件名称": "event_name", "事件类型": "type",
       "时间": "time", "地点": "location", "主要人物": "persons", "朝代": "dynasties"}

YEAR_RE = re.compile(r"[（\[][^（）\[\]]*?公元前\s*(\d+)")
events = []
for p in sorted(targets):
    txt = open(os.path.join(MDDIR, p), encoding="utf-8").read()
    ov = parse_overview(txt)
    det = parse_details(txt)
    for row in ov:
        e = {COL.get(k, k): v for k, v in row.items()}
        d = det.get(e.get("event_id", ""), {})
        for k, v in d.items():
            if k not in e or not e[k]: e[k] = v
            elif k in ("description", "source_text", "paragraph", "date_note"): e[k] = v
        e["chapter"] = p
        events.append(e)

def year_of(t):
    if not t: return None
    m = YEAR_RE.search(t)
    if not m: return None
    n = int(m.group(1))
    return -n

def precision_of(t):
    if not t: return "unknown"
    if re.search(r"约公元前", t): return "circa"
    if re.search(r"[（(]公元前", t): return "exact"
    if re.search(r"\[公元前", t): return "inferred"
    return "unknown"

for e in events:
    e["year"] = year_of(e.get("time", ""))
    e["precision"] = precision_of(e.get("time", ""))

print("parsed events:", len(events), "with year:", sum(1 for e in events if e["year"] is not None))
json.dump(events, open(os.path.join(TMP, "shiji_events.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("saved", os.path.join(TMP, "shiji_events.json"))
