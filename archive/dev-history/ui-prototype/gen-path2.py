"""根据参考线稿关键点生成平滑 SVG 路径（均匀缩放 + Catmull-Rom）。"""
# 参考图 202x150；内容 x 24..169, y 25..127
# 均匀映射：x' = 3 + (x-24)*0.29 ; y' = 9.2 + (y-25)*0.29
def m(p):
    x, y = p
    return (3 + (x - 24) * 0.29, 9.2 + (y - 25) * 0.29)

def fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")

def catmull(points, tension=0.5):
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

A = [(24,89),(36,86),(57,84),(67,86),(76,91),(90,103),(97,107),(107,106),(110,101),(108,93),(88,85),(73,71),(67,67)]
B = [(67,67),(91,27)]
C = [(91,27),(102,31),(107,37),(113,43),(115,48)]
D = [(115,48),(99,49),(96,51)]
E = [(96,51),(94,53),(92,55),(92,62),(96,66),(105,70),(112,71),(119,76),(123,80),(129,92),(129,94),(128,109),(127,111),(122,118),(121,119),(120,120),(110,126),(97,127),(82,121),(69,109),(67,108),(56,102),(36,103),(34,104),(24,107)]
UP = [(129,92),(153,91),(169,86)]
DOWN = [(128,109),(153,109),(169,104)]

def strip_m(seg):
    first = m(seg[0])
    s = catmull(seg)
    prefix = f"M {fmt(first[0])} {fmt(first[1])} "
    assert s.startswith(prefix), s[:40]
    return s[len(prefix):]

full = ""
full += catmull(A)
full += " L " + f"{fmt(m(B[1])[0])} {fmt(m(B[1])[1])}"  # fold left straight
full += " " + strip_m(C)  # fold right (starts at apex already)
full += " " + strip_m(D)
full += " " + strip_m(E)
print("MAIN:\n" + full)
print("\nUP:\n" + catmull(UP))
print("\nDOWN:\n" + catmull(DOWN))
