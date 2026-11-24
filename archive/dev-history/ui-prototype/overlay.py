from PIL import Image

z6 = Image.open(r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\z6-alone.png").convert("RGBA")
# Z6 内容映射：viewBox -3..45 x, -8..40 y -> 0..480（比例 10）
# 内容区域 x 3..45 => 60..480, y 8..40 => 160..480
z6_content = z6.crop((60, 160, 480, 480))  # 420x320

ref = Image.open(r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\ref-logo.png").convert("RGBA")
# 参考图内容边界 x 24..169, y 25..127 => 145x102，缩放到 420x320
ref_content = ref.crop((24, 25, 169, 127)).resize((420, 320), Image.LANCZOS)

canvas = Image.new("RGBA", (420, 320), (255, 253, 248, 255))
# 参考图铺灰
ref_gray = ref_content.convert("L").convert("RGBA")
canvas.alpha_composite(ref_gray)
# Z6 红色半透明叠加
red = Image.new("RGBA", (420, 320), (139, 0, 0, 0))
z6_alpha = z6_content.split()[3].point(lambda v: int(v * 0.7))
red.putalpha(z6_alpha)
canvas.alpha_composite(red)
canvas.resize((840, 640), Image.LANCZOS).save(r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\overlay.png")
print("ok")
