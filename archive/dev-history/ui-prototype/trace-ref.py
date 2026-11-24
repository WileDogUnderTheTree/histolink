"""把参考 Logo 线稿细化成 1px 骨架，并打印 ASCII 图，便于手写 SVG 时对齐拓扑。"""
import numpy as np
from PIL import Image

src = r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\ref-logo.png"
img = Image.open(src).convert("L")
a = np.array(img)
ink = a < 145

# pad 1px border
b = np.pad(ink, 1).astype(bool)
H, W = b.shape

P = {}
for _ in range(200):
    changed = False
    for step in (0, 1):
        P2 = b[:-2, 1:-1]
        P3 = b[:-2, 2:]
        P4 = b[1:-1, 2:]
        P5 = b[2:, 2:]
        P6 = b[2:, 1:-1]
        P7 = b[2:, :-2]
        P8 = b[1:-1, :-2]
        P9 = b[:-2, :-2]
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
print("image", W - 2, H - 2, "skeleton pixels", len(xs))
print("x range", xs.min(), xs.max(), "y range", ys.min(), ys.max())

# ASCII: 3x3 blocks
BS = 3
rows = []
for by in range(0, skel.shape[0], BS):
    row = []
    for bx in range(0, skel.shape[1], BS):
        block = skel[by:by + BS, bx:bx + BS]
        row.append("#" if block.any() else " ")
    rows.append("".join(row))
print("\n".join(rows))
