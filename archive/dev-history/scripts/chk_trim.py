# -*- coding: utf-8 -*-
import json, re, os
TMP = r".tmp"
rows = json.load(open(os.path.join(TMP, "final_136.json"), encoding="utf-8"))
kept = {r["event_id"]: r for r in rows}
review = open(os.path.join(TMP, "desc_review.txt"), encoding="utf-8").read().split("\n\n")
# 找出：正文以「。」结尾但原描述在该位置不是句号（说明是逗号截断补句号）
for block in review:
    head, desc = block.split("\n    ", 1)
    body = desc.split("（据《史记")[0]
    if len(body) >= 60 and body.count("。") == 1:
        # 只有一句且较长，提示可能截断
        print(head, "|", body)
