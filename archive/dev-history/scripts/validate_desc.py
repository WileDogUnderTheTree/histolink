# -*- coding: utf-8 -*-
import json, re, os
TMP = r".tmp"
rows = json.load(open(os.path.join(TMP, "final_136.json"), encoding="utf-8"))
review = open(os.path.join(TMP, "desc_review.txt"), encoding="utf-8").read().split("\n\n")
print("== short bodies ==")
for block in review:
    head, desc = block.split("\n    ", 1)
    body = desc.split("（据《史记")[0]
    if len(body) < 30:
        print(head, "|", body, len(body))
print("== 未以句号结尾 ==")
for block in review:
    head, desc = block.split("\n    ", 1)
    body = desc.split("（据《史记")[0]
    if not body.endswith("。"):
        print(head, "|", body)
