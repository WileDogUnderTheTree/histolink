# -*- coding: utf-8 -*-
"""Gather concrete counts for the batch-1 data plan (output as UTF-8 file)."""
import json, re, urllib.request, collections, os

OUT = []
def log(*a):
    OUT.append(" ".join(str(x) for x in a))

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "dsh-agent"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read().decode("utf-8")

# ---------- 1. chinese-history: events per dynasty ----------
log("=" * 20, "1. chinese-history events/ 文件与事件数", "=" * 20)
tree = json.loads(get("https://api.github.com/repos/anthonyhann/chinese-history/git/trees/master?recursive=1"))["tree"]
ev_files = [t for t in tree if t["path"].startswith("events/") and t["path"].endswith(".json") and t["type"] == "blob"]
total = 0
per_dyn = collections.Counter()
for f in ev_files:
    raw = get("https://raw.githubusercontent.com/anthonyhann/chinese-history/master/" + f["path"])
    try:
        j = json.loads(raw)
    except Exception as e:
        log("PARSE FAIL", f["path"], e)
        continue
    if isinstance(j, list):
        n = len(j)
    elif isinstance(j, dict):
        n = len(j.get("events", j.get("items", []))) or 1
    else:
        n = 1
    total += n
    per_dyn[f["path"].split("/")[1]] += n
    log(f"{f['path']:52s} {n:4d}  bytes={f['size']}")
log("TOTAL chinese-history events:", total)
log("per dynasty:", dict(per_dyn))
log("是否存在 events/xia|shang|zhou 目录:",
    [p for p in per_dyn if p in ("xia", "shang", "zhou")])

# ---------- 2. 史记编年表: counts by era section ----------
log("\n" + "=" * 20, "2. shiji-kb 史记编年表 分区事件数", "=" * 20)
txt = get("https://raw.githubusercontent.com/baojie/shiji-kb/main/kg/chronology/data/%E5%8F%B2%E8%AE%B0%E7%BC%96%E5%B9%B4%E8%A1%A8.md")
cur = None
stat = collections.Counter()
rows_by_sec = collections.defaultdict(int)
for line in txt.splitlines():
    if line.startswith("## "):
        cur = line[3:].strip()
        log("  [H2]", cur)
    elif line.startswith("### "):
        cur = line[4:].strip()
    elif re.match(r"^\|[^|]", line) and cur:
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) >= 2 and not set(cells[0]) <= set("-: "):
            stat[cur] += 1
for k, v in stat.items():
    log(f"  {k:44s} {v}")
log("编年表总行数:", sum(stat.values()))

# ---------- 3. shiji-kb 事件时间索引: 时期分布 ----------
log("\n" + "=" * 20, "3. shiji-kb 事件时间索引 时期分布", "=" * 20)
idx = get("https://raw.githubusercontent.com/baojie/shiji-kb/main/kg/events/%E4%BA%8B%E4%BB%B6%E6%97%B6%E9%97%B4%E7%B4%A2%E5%BC%95.md")
for line in idx.splitlines():
    if line.startswith("| 远古") or line.startswith("| 商") or line.startswith("| 西周") or line.startswith("| 春秋") or line.startswith("| 战国") or line.startswith("| 秦（") or line.startswith("| 西汉"):
        log(" ", line)

with open(os.path.join(os.path.dirname(__file__), "out_counts.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(OUT))
print("written", len(OUT), "lines")
