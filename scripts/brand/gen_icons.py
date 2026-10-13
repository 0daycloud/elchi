#!/usr/bin/env python3
"""Generate Elchi's icon artwork (app icon master + tray glyphs) as SVG.

The motif is the 8-petal Iznik rosette from the brand films
(stt-website/video/src/film/motifs.ts): eight ellipses at radius 24
(rx 17, ry 9) in a 100-unit box, a centre disc and eight petal dots.

Usage: python3 scripts/brand/gen_icons.py <out_dir>
Writes elchi.svg (app icon master) and tray_*.svg glyphs into out_dir.
Render with rsvg-convert, e.g. `rsvg-convert -w 1024 elchi.svg -o icon.png`.
"""
import math
import sys
from pathlib import Path

PAPER = "#efe6d2"
LIGHT = "#7c98d9"
INK = "#1c3a94"


def petals(cx, cy, s, fill, extra=""):
    out = []
    for i in range(8):
        a = i / 8 * math.tau
        x, y = cx + math.cos(a) * 24 * s, cy + math.sin(a) * 24 * s
        out.append(
            f'<ellipse cx="{x:.2f}" cy="{y:.2f}" rx="{17 * s:.2f}" ry="{9 * s:.2f}" '
            f'transform="rotate({math.degrees(a):.2f} {x:.2f} {y:.2f})" fill="{fill}"{extra}/>'
        )
    return "\n    ".join(out)


def petal_dots(cx, cy, s, r, fill):
    out = []
    for i in range(8):
        a = i / 8 * math.tau
        out.append(
            f'<circle cx="{cx + math.cos(a) * 31 * s:.2f}" cy="{cy + math.sin(a) * 31 * s:.2f}" '
            f'r="{r * s:.2f}" fill="{fill}"/>'
        )
    return "\n    ".join(out)


def halftone(cx, cy, r_in, r_out, pitch, max_r, fill):
    """Light-ink halftone ring: dots shrink from r_in outward to r_out."""
    dots = []
    rows = int((2 * r_out) / (pitch * 0.866)) + 2
    cols = int((2 * r_out) / pitch) + 2
    for row in range(rows):
        for col in range(cols):
            x = cx - r_out + col * pitch + (pitch / 2 if row % 2 else 0)
            y = cy - r_out + row * pitch * 0.866
            d = math.hypot(x - cx, y - cy)
            if d > r_out or d < r_in * 0.55:
                continue
            t = 1 - max(0.0, (d - r_in)) / (r_out - r_in) if d > r_in else 1.0
            rr = max_r * math.sqrt(max(0.0, t))
            if rr < 1.2:
                continue
            dots.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rr:.2f}"/>')
    return f'<g fill="{fill}">' + "".join(dots) + "</g>"


def app_icon():
    c, s = 512, 6.4  # rosette ~525 px across on the 824 px tile
    off = (13, 10)  # light-ink plate slightly off register (down-right)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>Elchi</title>
  <defs>
    <clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.29  0 0 0 0 0.18  1.1 0 0 0 -0.52"/>
    </filter>
  </defs>
  <g clip-path="url(#tile)">
    <rect x="100" y="100" width="824" height="824" fill="{PAPER}"/>
    {halftone(c + off[0], c + off[1], 235, 372, 24, 8.5, LIGHT)}
    <!-- light ink plate -->
    <g style="mix-blend-mode:multiply">
    {petals(c + off[0], c + off[1], s, LIGHT)}
    </g>
    <!-- cobalt ink plate -->
    {petals(c, c, s, INK)}
    <!-- paper showing through the cobalt -->
    <circle cx="{c}" cy="{c}" r="{12.5 * s:.2f}" fill="{PAPER}"/>
    {petal_dots(c, c, s, 2.9, PAPER)}
    <circle cx="{c + off[0] * 0.6:.1f}" cy="{c + off[1] * 0.6:.1f}" r="{7.5 * s:.2f}" fill="{LIGHT}"/>
    <circle cx="{c}" cy="{c}" r="{5.2 * s:.2f}" fill="{INK}"/>
    <rect x="100" y="100" width="824" height="824" filter="url(#grain)" opacity="0.55"/>
  </g>
</svg>
"""


# ---- tray glyphs (64x64, single colour; macOS uses them as template images) --


def rosette_glyph(color, cx=32, cy=32, s=0.70, knock=None):
    """Solid rosette with the centre ring knocked out (no petal dots: they
    turn to noise at menu-bar size)."""
    mask_id = f"m{abs(hash((cx, cy, s))) % 10000}"
    return f"""<mask id="{mask_id}">
    <rect width="64" height="64" fill="#fff"/>
    <circle cx="{cx}" cy="{cy}" r="{12 * s:.2f}" fill="#000"/>
    <circle cx="{cx}" cy="{cy}" r="{6 * s:.2f}" fill="#fff"/>
    {knock or ""}
  </mask>
  <g mask="url(#{mask_id})">
    <circle cx="{cx}" cy="{cy}" r="{16 * s:.2f}" fill="{color}"/>
    {petals(cx, cy, s, color)}
  </g>"""


def star16(cx, cy, r_out, r_in, fill):
    pts = []
    for i in range(16):
        a = i / 16 * math.tau - math.pi / 2
        r = r_in if i % 2 else r_out
        pts.append(f"{cx + math.cos(a) * r:.2f},{cy + math.sin(a) * r:.2f}")
    return f'<polygon points="{" ".join(pts)}" fill="{fill}"/>'


def tray_svg(body):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">\n  '
        + body
        + "\n</svg>\n"
    )


def tray_idle(color):
    return tray_svg(rosette_glyph(color))


def tray_recording(color):
    # Filled disc with the rosette cut out: "listening".
    s = 0.56
    cut = petals(32, 32, s, "#000")
    return tray_svg(
        f"""<mask id="rec">
    <rect width="64" height="64" fill="#fff"/>
    {cut}
    <circle cx="32" cy="32" r="{12 * s:.2f}" fill="#fff"/>
    <circle cx="32" cy="32" r="{7 * s:.2f}" fill="#000"/>
  </mask>
  <circle cx="32" cy="32" r="31" fill="{color}" mask="url(#rec)"/>"""
    )


def tray_transcribing(color):
    # Filled disc with the 16-point star cut out: "writing".
    return tray_svg(
        f"""<mask id="tx">
    <rect width="64" height="64" fill="#fff"/>
    {star16(32, 32, 23, 13.5, "#000")}
    <circle cx="32" cy="32" r="7.5" fill="#fff"/>
    <circle cx="32" cy="32" r="3.2" fill="#000"/>
  </mask>
  <circle cx="32" cy="32" r="31" fill="{color}" mask="url(#tx)"/>"""
    )


def tray_warning(color):
    # Rosette with an exclamation badge in the lower-right corner.
    badge_cut = '<circle cx="48" cy="48" r="16" fill="#000"/>'
    return tray_svg(
        rosette_glyph(color, cx=28, cy=28, s=0.62, knock=badge_cut)
        + f"""
  <mask id="bang"><rect width="64" height="64" fill="#fff"/>
    <rect x="46" y="39" width="4" height="10.5" rx="2" fill="#000"/>
    <circle cx="48" cy="54.3" r="2.3" fill="#000"/>
  </mask>
  <circle cx="48" cy="48" r="13" fill="{color}" mask="url(#bang)"/>"""
    )


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    (out / "elchi.svg").write_text(app_icon())
    variants = {
        # file stem -> (builder, colour)
        "tray_idle": (tray_idle, "#ffffff"),
        "tray_idle_dark": (tray_idle, "#000000"),
        "tray_recording": (tray_recording, "#ffffff"),
        "tray_recording_dark": (tray_recording, "#000000"),
        "tray_transcribing": (tray_transcribing, "#ffffff"),
        "tray_transcribing_dark": (tray_transcribing, "#000000"),
        "tray_idle_warning": (tray_warning, "#ffffff"),
        "tray_idle_warning_dark": (tray_warning, "#000000"),
        # "Colored" theme (Linux trays, no template images): light ink.
        "handy": (tray_idle, LIGHT),
        "handy_warning": (tray_warning, LIGHT),
        "recording": (tray_recording, LIGHT),
        "transcribing": (tray_transcribing, LIGHT),
    }
    for stem, (fn, color) in variants.items():
        (out / f"{stem}.svg").write_text(fn(color))


if __name__ == "__main__":
    main()
