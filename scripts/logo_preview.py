"""Render the ORACLE mark at real favicon sizes and build a contact sheet to eyeball.

Checks the things that actually break small marks: whether the four arcs survive at
16 px, whether the centre dot stays distinct from the ring, and whether the tile
holds up against both a light and a dark browser tab bar.
"""
import io
import sys

import cairosvg
from PIL import Image

SRC = "frontend/public/oracle-mark.svg"
SIZES = [16, 20, 32, 48, 64, 128]
PAD = 14
LIGHT = (242, 242, 245)
DARK = (32, 33, 36)  # Chrome's dark tab bar


def render(size):
    png = cairosvg.svg2png(url=SRC, output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def strip(bg):
    """One row: every size composited onto bg, bottom-aligned."""
    imgs = [render(s) for s in SIZES]
    w = sum(i.width for i in imgs) + PAD * (len(imgs) + 1)
    h = max(i.height for i in imgs) + PAD * 2
    row = Image.new("RGB", (w, h), bg)
    x = PAD
    for im in imgs:
        row.paste(im, (x, h - PAD - im.height), im)
        x += im.width + PAD
    return row


light, dark = strip(LIGHT), strip(DARK)
sheet = Image.new("RGB", (max(light.width, dark.width), light.height + dark.height), LIGHT)
sheet.paste(light, (0, 0))
sheet.paste(dark, (0, light.height))
sheet = sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST)  # 3x nearest = see the pixels
sheet.save("/tmp/oracle_mark_sheet.png")

big = render(512)
big.convert("RGB").save("/tmp/oracle_mark_512.png")

# apple-touch-icon needs a raster PNG; ship one alongside the SVG favicon.
cairosvg.svg2png(url=SRC, write_to="frontend/public/apple-touch-icon.png",
                 output_width=180, output_height=180)

print(f"contact sheet : /tmp/oracle_mark_sheet.png  ({sheet.width}x{sheet.height}, 3x nearest)")
print(f"large render  : /tmp/oracle_mark_512.png")
print(f"apple icon    : frontend/public/apple-touch-icon.png (180x180)")
print("sizes rendered:", SIZES)
