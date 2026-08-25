"""One-off helper: exact OKLCH->sRGB conversion + arc geometry for the ORACLE mark.

Kept in-tree so the brand colours in the SVG assets are reproducible rather than
eyeballed. Not imported by the app.
"""
import math


def oklch_to_hex(L, C, h_deg):
    """Bjorn Ottosson's Oklab -> linear sRGB -> gamma-encoded sRGB."""
    h = math.radians(h_deg)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    rgb = (
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )
    out = []
    for c in rgb:
        c = 12.92 * c if c <= 0.0031308 else 1.055 * (max(c, 0) ** (1 / 2.4)) - 0.055
        out.append(round(max(0.0, min(1.0, c)) * 255))
    return "#%02X%02X%02X" % tuple(out), tuple(out)


for name, args in [
    ("primary   ", (0.55, 0.20, 265)),
    ("dark bg   ", (0.13, 0.02, 265)),
    ("orb indigo", (0.50, 0.20, 265)),
    ("orb magenta", (0.50, 0.15, 320)),
]:
    hx, rgb = oklch_to_hex(*args)
    print(f"{name} oklch{args} -> {hx}  rgb{rgb}")

print("\n--- arc endpoints: R=21, four 76deg segments, 14deg gaps on the diagonals ---")
CX = CY = 32.0
R = 21.0


def pt(deg):
    r = math.radians(deg)
    return CX + R * math.cos(r), CY + R * math.sin(r)


for i, centre in enumerate([-90, 0, 90, 180], start=1):
    a0, a1 = centre - 38, centre + 38
    x0, y0 = pt(a0)
    x1, y1 = pt(a1)
    print(f"seg{i} ({a0:+.0f}..{a1:+.0f})  "
          f'd="M {x0:.3f} {y0:.3f} A {R} {R} 0 0 1 {x1:.3f} {y1:.3f}"')

circ = 2 * math.pi * R
print(f"\ncircumference={circ:.3f}  dash(76deg)={circ * 76 / 360:.3f}  gap(14deg)={circ * 14 / 360:.3f}")
