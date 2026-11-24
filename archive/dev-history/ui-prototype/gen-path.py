"""根据参考线稿骨架关键点生成平滑 SVG 路径（Catmull-Rom → 三次贝塞尔）。"""
from pathlib import Path

# 参考图（202x150）上的关键点：沿真实笔画顺序
SEG_MAIN = [
    (24, 89), (31, 87), (36, 86), (57, 84), (59, 85), (67, 86), (76, 91),
    (81, 94), (90, 103), (92, 104), (97, 107), (107, 106), (110, 101),
    (108, 93), (106, 92), (88, 85), (77, 75), (73, 71), (68, 68), (67, 67),
]
SEG_FOLD_LEFT = [(67, 67), (91, 27)]
SEG_FOLD_RIGHT = [(91, 27), (102, 31), (107, 37), (113, 43), (115, 48)]
SEG_NOTCH = [(115, 48), (99, 49), (96, 51)]
SEG_HOOK_LOOP = [
    (96, 51), (94, 53), (92, 55), (92, 62), (96, 66), (105, 70), (112, 71),
    (119, 76), (123, 80), (129, 92), (129, 94), (128, 109), (127, 111),
    (122, 118), (121, 119), (120, 120), (110, 126), (97, 127), (82, 121),
    (69, 109), (67, 108), (56, 102), (36, 103), (34, 104), (24, 107),
]
SEG_STUB_UP = [(129, 92), (130, 93), (153, 91), (155, 90), (169, 86)]
SEG_STUB_DOWN = [(128, 109), (129, 110), (153, 109), (169, 104)]

# 映射到 48 viewBox：内容 x 3..45（宽 42），y 8..40（高 32）
def m(p):
    x, y = p
    return (3 + (x - 24) / 145 * 42, 8 + (y - 25) / 102 * 32)

def fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")

def catmull(points, tension=0.9):
    pts = [m(p) for p in points]
    if len(pts) < 2:
        return ""
    out = [f"M {fmt(pts[0][0])} {fmt(pts[0][1])}"]
    if len(pts) == 2:
        out.append(f"L {fmt(pts[1][0])} {fmt(pts[1][1])}")
        return " ".join(out)
    ext = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6 * tension, p1[1] + (p2[1] - p0[1]) / 6 * tension)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6 * tension, p2[1] - (p3[1] - p1[1]) / 6 * tension)
        out.append(
            f"C {fmt(c1[0])} {fmt(c1[1])} {fmt(c2[0])} {fmt(c2[1])} {fmt(p2[0])} {fmt(p2[1])}"
        )
    return " ".join(out)

paths = {
    "main": catmull(SEG_MAIN),
    "fold_left": catmull(SEG_FOLD_LEFT),
    "fold_right": catmull(SEG_FOLD_RIGHT),
    "notch": catmull(SEG_NOTCH),
    "hook_loop": catmull(SEG_HOOK_LOOP),
    "stub_up": catmull(SEG_STUB_UP),
    "stub_down": catmull(SEG_STUB_DOWN),
}

for name, d in paths.items():
    print(f"{name}: {d}\n")

# 合成一条主路径（在折角处用 L 保留几何切角）
main_d = " ".join([
    catmull(SEG_MAIN),
    f"L {fmt(m(SEG_FOLD_LEFT)[0][0])} {fmt(m(SEG_FOLD_LEFT)[0][1])}",
    f"L {fmt(m(SEG_FOLD_LEFT)[1][0])} {fmt(m(SEG_FOLD_LEFT)[1][1])}",
])
# 修正：catmull 已包含起点 M，这里直接拼 fold right 等
full = (
    catmull(SEG_MAIN)
    + " " + catmull(SEG_FOLD_LEFT).replace("M " + fmt(m(SEG_FOLD_LEFT)[0][0]) + " " + fmt(m(SEG_FOLD_LEFT)[0][1]) + " ", "L ", 1)
    + " " + catmull(SEG_FOLD_RIGHT).replace("M " + fmt(m(SEG_FOLD_RIGHT)[0][0]) + " " + fmt(m(SEG_FOLD_RIGHT)[0][1]) + " ", "L ", 1)
    + " " + catmull(SEG_NOTCH).replace("M " + fmt(m(SEG_NOTCH)[0][0]) + " " + fmt(m(SEG_NOTCH)[0][1]) + " ", "L ", 1)
    + " " + catmull(SEG_HOOK_LOOP).replace("M " + fmt(m(SEG_HOOK_LOOP)[0][0]) + " " + fmt(m(SEG_HOOK_LOOP)[0][1]) + " ", "L ", 1)
)
print("FULL:", full)
Path("C:/Users/wiledog/Desktop/史脉/.tmp/ui/newlogo-path.txt").write_text(full, encoding="utf-8")
