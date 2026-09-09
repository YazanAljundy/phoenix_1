"""Regenerates every FENIQ logo/icon asset in the repo from the two source PNGs.

Run from the repo root:  python assets/branding/generate_assets.py

Sources (assets/branding/source/):
  feniq-logo-light.png  navy wing  - for LIGHT backgrounds
  feniq-logo-dark.png   silver wing - for DARK backgrounds

Everything under phoenix/assets/images, phoenix/android, phoenix/ios,
phoenix/web and web/public that carries the brand is derived here, so the
brand only ever has to be re-cut in one place.
"""

import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "assets", "branding", "source")

# Brand solids (see AppColors / index.css - kept identical on purpose).
NAVY_DARK = (14, 26, 44, 255)   # #0E1A2C - app-icon ground
LIGHT_BG = (247, 247, 248, 255)  # #F7F7F8

# The wordmark sits below the bird. Measured on both sources, not guessed:
# the bird's tail tapers out at y=390, rows 391-400 are the Arabic letter dots
# (they float free, well above their letter bodies), 402-445 is "فينيق" proper
# and 456-503 is "FENIQ". Cutting at 391 keeps those loose dots out of the
# mark - at 402 they ride along as four orange specks under the bird.
BIRD_BAND = (0, 160, 393, 391)


def out(*parts):
    p = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def load(variant):
    return Image.open(os.path.join(SRC, f"feniq-logo-{variant}.png")).convert("RGBA")


def trimmed(im, pad_ratio=0.0):
    """Tight-crop to the artwork, then optionally re-pad by a share of the long edge."""
    im = im.crop(im.getbbox())
    if pad_ratio:
        pad = int(max(im.size) * pad_ratio)
        canvas = Image.new("RGBA", (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
        canvas.paste(im, (pad, pad), im)
        im = canvas
    return im


def bird(variant):
    """Just the phoenix, no wordmark - for app icons and tight spots (app bars)."""
    return trimmed(load(variant).crop(BIRD_BAND))


def square(im, size, bg=None, inset=0.14):
    """Fit `im` centred into a square, optionally over a solid ground.

    inset is the share of the canvas left as breathing room on the long edge -
    iOS/Android both crop or mask icons, so the mark must not touch the edge.

    Note this scales in BOTH directions (Image.resize, not Image.thumbnail -
    thumbnail refuses to enlarge, which silently left the mark at its native
    196x231 in the middle of a 1024px canvas). The source art tops out at
    393x635, so the 1024 App Store icon is a ~3.2x upscale; see README.
    """
    canvas = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    box = size * (1 - inset * 2)
    scale = min(box / im.width, box / im.height)
    art = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))),
                    Image.LANCZOS)
    canvas.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
    return canvas.convert("RGB") if bg else canvas


def width_to(im, w):
    return im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)


def save(im, path):
    im.save(path, "PNG", optimize=True)
    print(f"  {os.path.relpath(path, ROOT)}  {im.size[0]}x{im.size[1]}")


written = []


def emit(im, *parts):
    p = out(*parts)
    save(im, p)
    written.append(p)


print("Full lockups (bird + wordmark), trimmed with 4% breathing room:")
for variant in ("light", "dark"):
    lockup = trimmed(load(variant), pad_ratio=0.04)
    mark = trimmed(bird(variant), pad_ratio=0.04)
    # Flutter app: @1x 420px wide is plenty for a 200px-wide splash on 3x.
    emit(width_to(lockup, 640), "phoenix", "assets", "images", f"feniq_logo_{variant}.png")
    emit(width_to(mark, 320), "phoenix", "assets", "images", f"feniq_mark_{variant}.png")
    # React admin/warehouse panels.
    emit(width_to(lockup, 640), "web", "public", "images", f"feniq-logo-{variant}.png")
    emit(width_to(mark, 320), "web", "public", "images", f"feniq-mark-{variant}.png")

print("\nApp icons - bird only on solid #0E1A2C (stores reject alpha on iOS):")
icon_src = trimmed(bird("dark"))  # silver bird reads best on the navy ground

# Single flattened master, so `dart run flutter_launcher_icons` has a real
# file to point at (pubspec's image_path) and reproduces what we commit here.
emit(square(icon_src, 1024, NAVY_DARK), "phoenix", "assets", "images", "feniq_icon_source.png")

ANDROID = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for dpi, px in ANDROID.items():
    emit(square(icon_src, px, NAVY_DARK),
         "phoenix", "android", "app", "src", "main", "res", f"mipmap-{dpi}", "ic_launcher.png")

IOS = [
    ("20x20", 1, 20), ("20x20", 2, 40), ("20x20", 3, 60),
    ("29x29", 1, 29), ("29x29", 2, 58), ("29x29", 3, 87),
    ("40x40", 1, 40), ("40x40", 2, 80), ("40x40", 3, 120),
    ("50x50", 1, 50), ("50x50", 2, 100),
    ("57x57", 1, 57), ("57x57", 2, 114),
    ("60x60", 2, 120), ("60x60", 3, 180),
    ("72x72", 1, 72), ("72x72", 2, 144),
    ("76x76", 1, 76), ("76x76", 2, 152),
    ("83.5x83.5", 2, 167),
    ("1024x1024", 1, 1024),
]
# Exactly the slots Runner's AppIcon.appiconset/Contents.json declares - an
# extra .png in that folder is a file Xcode never references.
for name, scale, px in IOS:
    emit(square(icon_src, px, NAVY_DARK),
         "phoenix", "ios", "Runner", "Assets.xcassets", "AppIcon.appiconset",
         f"Icon-App-{name}@{scale}x.png")

print("\nWeb / PWA icons:")
# Flutter web PWA - maskable variants need a much deeper inset (the OS crops
# to a circle on Android), so they get their own inset.
for px in (192, 512):
    emit(square(icon_src, px, NAVY_DARK), "phoenix", "web", "icons", f"Icon-{px}.png")
    emit(square(icon_src, px, NAVY_DARK, inset=0.26),
         "phoenix", "web", "icons", f"Icon-maskable-{px}.png")
emit(square(icon_src, 192, NAVY_DARK), "phoenix", "web", "favicon.png")

# React panel favicons - light ground, since browser tab strips are usually light.
for px in (16, 32, 48, 180):
    emit(square(bird("light"), px, LIGHT_BG), "web", "public", f"favicon-{px}.png")
emit(square(bird("light"), 180, LIGHT_BG), "web", "public", "apple-touch-icon.png")

print(f"\n{len(written)} files written.")
