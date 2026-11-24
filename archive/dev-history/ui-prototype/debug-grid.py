"""在参考图上叠加骨架与坐标网格，便于人工读图。"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

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

scale = 5
W, H = img.size
canvas = Image.new("RGB", (W * scale + 60, H * scale + 40), "#fffdf8")
draw = ImageDraw.Draw(canvas)
# 放大原图做浅灰背景：把线稿画成浅灰
base = Image.eval(img, lambda v: 255 - int((255 - v) * 0.25)).resize((W * scale, H * scale), Image.LANCZOS).convert("RGB")
canvas.paste(base, (60, 40))

# 网格
for x in range(0, W + 1, 20):
    px = 60 + x * scale
    draw.line([(px, 40), (px, 40 + H * scale)], fill="#e2d9cc", width=1)
    draw.text((px - 10, 8), str(x), fill="#8b0000")
for y in range(0, H + 1, 20):
    py = 40 + y * scale
    draw.line([(60, py), (60 + W * scale, py)], fill="#e2d9cc", width=1)
    draw.text((8, py - 6), str(y), fill="#8b0000")

# 骨架点
ys, xs = np.nonzero(skel)
for x, y in zip(xs, ys):
    px = 60 + int(x) * scale
    py = 40 + int(y) * scale
    draw.ellipse([px - 2, py - 2, px + 2, py + 2], fill="#1f5ed8")

# 关键点
for label, (x, y) in {
    "apex": (91, 27),
    "point": (115, 48),
    "notch": (96, 51),
    "hookEnd": (119, 76),
    "rightJ": (129, 93),
    "loopR": (121, 119),
    "loopB": (97, 127),
    "loopL": (69, 109),
    "foldL": (67, 67),
    "mid": (106, 92),
}.items():
    px = 60 + x * scale
    py = 40 + y * scale
    draw.ellipse([px - 5, py - 5, px + 5, py + 5], outline="#0a7a3f", width=2)
    draw.text((px + 7, py - 12), label, fill="#0a7a3f")

canvas.save(r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\ref-grid.png")
print("saved", canvas.size)
