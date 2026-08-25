"""Quantitative legibility check for the ORACLE mark at favicon sizes.

Eyeballing a 16x16 icon is unreliable, so measure the things that decide whether a
small mark survives:
  A. gap contrast  - are the four arcs separated, or has the ring fused into a donut?
  B. moat contrast - is the centre dot detached from the ring?
  C. accent delta  - is the bright top arc actually brighter than the other three?
Sampling is done on the true-resolution render, not an upscale.
"""
import io
import math

import cairosvg
from PIL import Image

SRC = "frontend/public/oracle-mark.svg"
VB = 64.0            # viewBox units
R_RING = 21.0        # ring radius in viewBox units
R_DOT = 6.5          # centre dot radius
STROKE = 8.0
BG = (54, 101, 228)  # #3665E4
FG = (255, 255, 255)

ARC_DIRS = {"top(accent)": -90, "right": 0, "bottom": 90, "left": 180}
GAP_DIRS = {"NE": -45, "SE": 45, "SW": 135, "NW": 225}


def render(size):
    png = cairosvg.svg2png(url=SRC, output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGB")


def sample(img, size, r_vb, deg):
    """Average the pixels a small disc around one polar sample point (anti-aliasing safe)."""
    s = size / VB
    cx = cy = size / 2.0
    x = cx + r_vb * s * math.cos(math.radians(deg))
    y = cy + r_vb * s * math.sin(math.radians(deg))
    acc, n = [0, 0, 0], 0
    for dx in (-0.5, 0.0, 0.5):
        for dy in (-0.5, 0.0, 0.5):
            px, py = int(round(x + dx)), int(round(y + dy))
            if 0 <= px < size and 0 <= py < size:
                p = img.getpixel((px, py))
                acc = [a + c for a, c in zip(acc, p)]
                n += 1
    return tuple(a / n for a in acc)


def whiteness(px):
    """0.0 = pure background colour, 1.0 = pure white ink."""
    num = sum((c - b) ** 2 for c, b in zip(px, BG)) ** 0.5
    den = sum((f - b) ** 2 for f, b in zip(FG, BG)) ** 0.5
    return num / den


print(f"{'size':>5} | {'arcs(mean ink)':>14} | {'gaps(mean ink)':>14} | "
      f"{'A separation':>12} | {'B moat':>8} | {'C accent':>9}")
print("-" * 82)

verdict = []
for size in (16, 20, 32, 48, 64, 128):
    img = render(size)
    arcs = {k: whiteness(sample(img, size, R_RING, d)) for k, d in ARC_DIRS.items()}
    gaps = {k: whiteness(sample(img, size, R_RING, d)) for k, d in GAP_DIRS.items()}
    # moat = the empty annulus between dot edge and ring inner edge
    r_moat = (R_DOT + (R_RING - STROKE / 2)) / 2
    moat = min(whiteness(sample(img, size, r_moat, d)) for d in (-90, 0, 90, 180))
    dot = whiteness(sample(img, size, 0.0, 0))

    arc_mean = sum(arcs.values()) / 4
    gap_mean = sum(gaps.values()) / 4
    sep = arc_mean - gap_mean                       # A: want a big positive number
    others = [v for k, v in arcs.items() if k != "top(accent)"]
    accent = arcs["top(accent)"] - sum(others) / 3  # C: want clearly positive

    print(f"{size:>5} | {arc_mean:>14.3f} | {gap_mean:>14.3f} | "
          f"{sep:>12.3f} | {moat:>8.3f} | {accent:>9.3f}")
    verdict.append((size, sep, moat, accent, dot))

print("\nthresholds: A separation > 0.25 (arcs read as separate), "
      "B moat < 0.35 (dot detached), C accent > 0.15 (emphasis visible)")
print("-" * 82)
ok = True
for size, sep, moat, accent, dot in verdict:
    flags = []
    if sep <= 0.25:
        flags.append(f"A FAIL sep={sep:.3f} (ring fusing)")
    if moat >= 0.35:
        flags.append(f"B FAIL moat={moat:.3f} (dot merging into ring)")
    if accent <= 0.15:
        flags.append(f"C FAIL accent={accent:.3f} (no emphasis)")
    if dot < 0.75:
        flags.append(f"dot too dim ({dot:.3f})")
    if flags:
        ok = False
        print(f"  {size:>3}px  " + "; ".join(flags))
    else:
        print(f"  {size:>3}px  pass")
print("\nRESULT:", "all sizes legible" if ok else "NEEDS GEOMETRY FIX")
