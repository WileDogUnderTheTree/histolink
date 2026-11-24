from PIL import Image

z6 = Image.open(r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\z6-alone.png").convert("RGBA")
z6_content = z6.crop((60, 160, 480, 480))  # 420x320

ref = Image.open(r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\ref-logo.png").convert("RGBA")
ref_content = ref.crop((24, 25, 169, 127)).resize((420, 320), Image.LANCZOS)

# 白底 + 参考图深灰线 + Z6 蓝色线
canvas = Image.new("RGBA", (420, 320), (255, 253, 248, 255))
ref_rgb = ref_content.convert("L").convert("RGBA")
canvas.alpha_composite(ref_rgb)

blue = Image.new("RGBA", (420, 320), (20, 90, 220, 0))
blue.putalpha(z6_content.split()[3])
canvas.alpha_composite(blue)
canvas.resize((840, 640), Image.LANCZOS).save(r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\overlay2.png")
print("ok")
