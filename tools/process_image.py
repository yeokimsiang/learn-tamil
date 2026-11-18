"""Crop the bottom watermark strip, shrink and save as colour WebP."""
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
w, h = im.size
crop = int(h * 0.09)  # watermark sits in the bottom ~8%
side = h - crop
left = (w - side) // 2
im = im.crop((left, 0, left + side, side))
im = im.resize((360, 360), Image.LANCZOS)
im.save(dst, "WEBP", quality=60, method=6)
