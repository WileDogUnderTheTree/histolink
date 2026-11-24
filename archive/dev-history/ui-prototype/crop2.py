from PIL import Image

im = Image.open(r".tmp\ui\v2-ask-topbar.png")
crop = im.crop((310, 0, 760, 100)).resize((1800, 400), Image.LANCZOS)
crop.save(r".tmp\ui\v2-logo-zoom.png")
print("ok")
