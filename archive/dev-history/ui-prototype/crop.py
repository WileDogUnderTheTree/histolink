from PIL import Image

base = r".tmp\ui"
for name, box, size in [
    ("ask-logo2", (320, 0, 780, 110), (1380, 330)),
    ("final-ask-clean", (300, 50, 1140, 120), (1680, 140)),
]:
    im = Image.open(f"{base}\\{name}.png")
    crop = im.crop(box).resize(size, Image.LANCZOS)
    crop.save(f"{base}\\crop-{name}.png")
print("ok")
