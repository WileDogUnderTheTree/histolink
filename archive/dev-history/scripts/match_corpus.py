import json
import pathlib
import re

corpus_files = [
    pathlib.Path("docs/史脉_RAG语料库_核心历史事件.md"),
    pathlib.Path("docs/史脉_RAG语料库_第二批30篇.md"),
]
snapshot = json.loads(pathlib.Path("backend/data/snapshot.v1.json").read_text(encoding="utf-8"))
events = snapshot["events"]
by_title = {}
for e in events:
    by_title.setdefault(e["title"], []).append(e)

YEAR_RE = re.compile(r"(?:公元前|前)(\d{1,4})年|(\d{3,4})年")


def first_year(text):
    for m in YEAR_RE.finditer(text):
        if m.group(1):
            return -int(m.group(1))
        return int(m.group(2))
    return None


def normalize(title):
    t = title.replace("【传说】", "").strip()
    t = re.sub(r"（[^）]*）", "", t).strip()
    t = re.sub(r"·.*$", "", t).strip()
    return t


docs = []
for f in corpus_files:
    text = f.read_text(encoding="utf-8")
    for block in re.split(r"^## ", text, flags=re.M)[1:]:
        lines = block.splitlines()
        title = lines[0].strip()
        body = "\n".join(lines[1:])
        m = re.search(r"### 白话文详述\n(.*?)(?=\n### |\Z)", body, re.S)
        vernacular = (m.group(1).strip() if m else "")
        docs.append((f.name, title, vernacular))

print("docs:", len(docs))
for fname, title, vernacular in docs:
    norm = normalize(title)
    candidates = by_title.get(title) or by_title.get(norm) or []
    if not candidates:
        candidates = [e for t, es in by_title.items() if norm in t or t in norm for e in es]
    declared = first_year(vernacular)
    if candidates:
        for e in candidates[:3]:
            print(f"OK   | {title} -> {e['event_id']} | graph_year={e['year']} corpus_year={declared} | {e['title']}")
    else:
        print(f"MISS | {title} | corpus_year={declared}")
