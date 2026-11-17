"""Crop the bottom watermark strip, greyscale, shrink and save as WebP."""
import sys
from PIL import Image, ImageOps
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("L")
w, h = im.size
crop = int(h * 0.09)  # watermark sits in the bottom ~8%
side = h - crop
left = (w - side) // 2
im = im.crop((left, 0, left + side, side))
im = ImageOps.autocontrast(im, cutoff=1)
im = im.resize((360, 360), Image.LANCZOS)
im.save(dst, "WEBP", quality=55, method=6)
