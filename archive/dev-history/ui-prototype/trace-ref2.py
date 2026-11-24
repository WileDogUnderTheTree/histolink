"""细化骨架后按图结构追踪每条线段，输出端点和折线坐标，方便手写等价 SVG。"""
import numpy as np
from PIL import Image

src = r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\ref-logo.png"
img = Image.open(src).convert("L")
a = np.array(img)
ink = a < 145
b = np.pad(ink, 1).astype(bool)

for _ in range(200):
    changed = False
    for step in (0, 1):
        P2 = b[:-2, 1:-1]; P3 = b[:-2, 2:]; P4 = b[1:-1, 2:]; P5 = b[2:, 2:]
        P6 = b[2:, 1:-1]; P7 = b[2:, :-2]; P8 = b[1:-1, :-2]; P9 = b[:-2, :-2]
        B = sum(p.astype(np.int16) for p in (P2, P3, P4, P5, P6, P7, P8, P9))
        seq = [P9, P2, P3, P4, P5, P6, P7, P8, P9]
        A = sum(((~seq[i]) & seq[i + 1]).astype(np.int16) for i in range(8))
        center = b[1:-1, 1:-1]
        if step == 0:
            cond = center & (B >= 2) & (B <= 6) & (A == 1) & (~(P2 & P4 & P6)) & (~(P4 & P6 & P8))
        else:
            cond = center & (B >= 2) & (B <= 6) & (A == 1) & (~(P2 & P4 & P8)) & (~(P2 & P6 & P8))
        if cond.any():
            center[cond.nonzero()] = False
            changed = True
    if not changed:
        break

skel = b[1:-1, 1:-1]
ys, xs = np.nonzero(skel)
pts = set(zip(xs.tolist(), ys.tolist()))

def neighbors(p):
    x, y = p
    out = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            q = (x + dx, y + dy)
            if q in pts:
                out.append(q)
    return out

deg = {p: len(neighbors(p)) for p in pts}
ends = sorted([p for p, d in deg.items() if d == 1], key=lambda p: (p[1], p[0]))
junc = sorted([p for p, d in deg.items() if d >= 3], key=lambda p: (p[1], p[0]))
print("endpoints:", ends)
print("junctions:", junc)

# cluster junctions (adjacent junction pixels = one junction)
jset = set(junc)
clusters = []
for p in junc:
    if p not in jset:
        continue
    stack = [p]
    comp = []
    jset.discard(p)
    while stack:
        q = stack.pop()
        comp.append(q)
        for n in neighbors(q):
            if n in jset:
                jset.discard(n)
                stack.append(n)
    cx = sum(q[0] for q in comp) / len(comp)
    cy = sum(q[1] for q in comp) / len(comp)
    clusters.append({"pixels": set(comp), "c": (cx, cy)})
print("junction clusters:")
for i, c in enumerate(clusters):
    print(f"  J{i} at ({c['c'][0]:.1f},{c['c'][1]:.1f}) size={len(c['pixels'])}")

# Map junction pixels to cluster id
jpix = {}
for i, c in enumerate(clusters):
    for p in c["pixels"]:
        jpix[p] = i

# Trace edges: start from endpoints and from junction cluster boundary pixels
def walk(start, prev, stop_junction):
    path = [start]
    cur = start
    last = prev
    while True:
        nxts = [n for n in neighbors(cur) if n != last]
        # avoid going backwards into pixels we've just visited
        nxts = [n for n in nxts if n not in path[-2:]]
        if not nxts:
            return path, None
        # prefer non-junction continuation if multiple
        if len(nxts) > 1:
            # choose the one that isn't junction when possible
            nonj = [n for n in nxts if n not in jpix]
            nxt = nonj[0] if nonj else nxts[0]
        else:
            nxt = nxts[0]
        path.append(nxt)
        last, cur = cur, nxt
        if stop_junction and cur in jpix:
            return path, jpix[cur]
        if cur in ends and cur != start:
            return path, None
        if len(path) > 2000:
            return path, None

edges = []
visited_edges = set()

def edge_key(a, b):
    return tuple(sorted([a, b]))

# from endpoints
for e in ends:
    path, j = walk(e, None, True)
    if path and len(path) > 1:
        ekey = edge_key(path[0], path[-1])
        if ekey not in visited_edges or True:
            edges.append((path, j))
            visited_edges.add(ekey)

# from junction cluster pixels to other junctions/endpoints
for ci, c in enumerate(clusters):
    for p in sorted(c["pixels"]):
        for n in neighbors(p):
            if n in jpix:
                continue
            key = edge_key(p, n)
            if key in visited_edges:
                continue
            path, j = walk(n, p, True)
            if not path:
                continue
            full = [p] + path
            visited_edges.add(edge_key(p, path[-1]))
            edges.append((full, j))

# dedupe by endpoints+length
uniq = []
seen = set()
for path, j in edges:
    key = (path[0], path[-1], len(path))
    if key in seen:
        continue
    seen.add(key)
    uniq.append((path, j))

print(f"\nedges: {len(uniq)}")
for i, (path, j) in enumerate(uniq):
    # simplify with RDP
    def rdp(points, eps):
        if len(points) < 3:
            return points
        a, b = np.array(points[0], float), np.array(points[-1], float)
        ab = b - a
        abn = np.linalg.norm(ab)
        dmax, idx = 0, 0
        for k in range(1, len(points) - 1):
            p = np.array(points[k], float)
            if abn == 0:
                d = np.linalg.norm(p - a)
            else:
                d = abs(np.cross(ab, p - a)) / abn
            if d > dmax:
                dmax, idx = d, k
        if dmax > eps:
            left = rdp(points[:idx + 1], eps)
            right = rdp(points[idx:], eps)
            return left[:-1] + right
        return [points[0], points[-1]]

    simp = rdp(path, 1.2)
    pts_str = " ".join(f"({x},{y})" for x, y in simp)
    end = f"J{j}" if j is not None else "END/open"
    print(f"E{i}: {path[0]} -> {path[-1]} [{end}] len={len(path)}")
    print("   ", pts_str)
