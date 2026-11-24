import collections
import pathlib
import re

files = [
    pathlib.Path("docs/史脉_RAG语料库_核心历史事件.md"),
    pathlib.Path("docs/史脉_RAG语料库_第二批30篇.md"),
]
for f in files:
    text = f.read_text(encoding="utf-8")
    print("====", f.name, "chars", len(text))
    print("h3:", dict(collections.Counter(re.findall(r"^### (.+)$", text, re.M))))
    print("legend h2:", [line for line in re.findall(r"^## (.+)$", text, re.M) if "传说" in line])
    print("出处 lines:", len(re.findall(r"^\*\*出处：", text, re.M)))
    print("blockquote lines:", len(re.findall(r"^> ", text, re.M)))
    print("---- tail ----")
    print(text[-500:])
