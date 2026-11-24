# -*- coding: utf-8 -*-
"""Quick checks: chinese-history README coverage table + event counts per dynasty."""
import json, re, urllib.request, collections, io, sys

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "dsh-agent"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")

base = "https://raw.githubusercontent.com/anthonyhann/chinese-history/master/"
readme = get(base + "README.md")
print("README len:", len(readme))
# print lines mentioning 事件 or 覆盖
for line in readme.splitlines():
    if re.search(r"事件|覆盖|162|154|朝代", line):
        print("|", line.strip()[:180])
