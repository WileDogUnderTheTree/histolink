from PIL import Image
import numpy as np

def load_rgb(path):
    return np.array(Image.open(path).convert("RGB")).astype(np.float32)

# 参考图：内容边界 24..169 x, 25..127 y
ref = load_rgb(r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\ref-logo.png")
ref = Image.fromarray(ref.astype(np.uint8)).crop((24, 25, 169, 127)).resize((420, 320), Image.LANCZOS)
ref = np.array(ref).astype(np.float32)
ref_alpha = np.clip((200 - ref.mean(axis=2)) / 120, 0, 1) * 255

# Z6：x 3..45 => 60..480, y 8..40 => 160..480
z6 = load_rgb(r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\z6-alone.png")
z6 = Image.fromarray(z6.astype(np.uint8)).crop((60, 160, 480, 480)).resize((420, 320), Image.LANCZOS)
z6 = np.array(z6).astype(np.float32)
# 红线掩码：红色通道高、绿色低
redness = np.clip((z6[:, :, 0] - z6[:, :, 1] * 1.2) / 100, 0, 1) * 255

canvas = np.ones((320, 420, 3), dtype=np.float32) * np.array([255, 253, 248], dtype=np.float32)

def over(base, color, alpha):
    a = (alpha / 255.0)[..., None]
    return base * (1 - a) + np.array(color, dtype=np.float32) * a

canvas = over(canvas, [90, 90, 90], ref_alpha)
canvas = over(canvas, [200, 40, 30], redness)
Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8)).resize((840, 640), Image.LANCZOS).save(
    r"C:\Users\wiledog\Desktop\史脉\.tmp\ui\overlay3.png"
)
print("ok")
