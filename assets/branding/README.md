# FENIQ branding assets

Everything brand-shaped in this repo — logos, app icons, favicons — is
generated from the two files in `source/` by `generate_assets.py`. Nothing
under `phoenix/assets/images`, `phoenix/android`, `phoenix/ios`, `phoenix/web`
or `web/public` should be hand-edited: re-run the script instead, so the two
apps can never drift apart.

```
python assets/branding/generate_assets.py     # from the repo root
```

## Sources

| File | Colourway | Use on |
|---|---|---|
| `source/feniq-logo-light.png` | navy wing, orange body | **light** backgrounds |
| `source/feniq-logo-dark.png` | silver wing, orange body | **dark** backgrounds |

Both are 393×635 RGBA with real transparency. Which one to use is a property of
the *background*, not the screen — see `BrandLogo` in the Flutter app.

The artwork is a bird above a two-script wordmark (فينيق / FENIQ). Measured
row bands, not guessed:

| Rows | Content |
|---|---|
| 168–390 | the bird |
| 391–400 | the Arabic letter dots (they float free, well above their letters) |
| 402–445 | فينيق |
| 456–503 | FENIQ |

App icons and tight slots use the bird alone, cut at row **391**. Cutting at
the visually obvious gutter (row 401) instead drags those loose dots along and
they render as four orange specks floating under the bird.

## Palette verification

The identity's stated hexes were checked against the artwork before being
adopted, by clustering every pixel with alpha > 220 into hue families and
taking the frequency-weighted mean. ΔE below is CIE76 against the value now in
use.

| Role | In use | Measured in artwork | ΔE | Verdict |
|---|---|---|---|---|
| Orange | `#F2760A` | `#F76B1C` (light cut) / `#FE9829` (dark cut) | 8.8 / 14.8 | **Adopted.** The two cuts shade the body differently; the value in use sits between them and reads correctly against both. |
| Navy | `#16283F` | `#0D2645` | 5.8 | **Adopted.** Within tolerance of the wing colour. |
| Silver | `#E4E7EB` | `#BDBCB7` | 16.1 | **Adopted deliberately.** The wing is a metallic gradient (`#83817C` → `#FFFCFD`); its *mean* is a mid grey that would fail contrast as dark-mode body text. The value in use tracks the bright end of that gradient, which is the right call for a text/foreground role. |

Two further values are UI grounds rather than artwork colours, so there is
nothing to measure them against: `#0E1A2C` (dark-mode background, also the
app-icon ground) and `#F7F7F8` (light-mode background).

These live in exactly two places, and the two must be kept in step by hand:

- `phoenix/lib/core/constants/app_colors.dart` — the `_brand*` constants
- `web/src/index.css` — the `--brand-*` tokens on `:root`

## Known limitations

- **The source art is raster and small.** The bird is only ~196×234px in the
  source, so the 1024×1024 App Store icon is a ~3.2× LANCZOS upscale and is
  slightly soft on close inspection. Every other size is a downscale and is
  clean. A vector (SVG/AI) master would fix this — drop it in `source/` and
  rework the script's `load()` if one ever arrives.
- **The wordmark is baked into the raster**, so the lockup cannot be recoloured
  or re-set in another language without new art.

## Fonts

The identity's typeface is **Tajawal** (SIL OFL). Upstream ships
`200/300/400/500/700/800/900` — there is **no SemiBold/600 face**. The four
tiers the brand asks for are therefore realised as:

| Tier | Weight | Used for |
|---|---|---|
| Regular | 400 | body text |
| Medium | 500 | buttons, inputs, labels |
| "SemiBold" | **700** | subheadings |
| Bold | **800** | headings, prices |

Asking for `600` anywhere leaves the renderer synthesising a fake weight off
the 500 face, so don't. Flutter bundles the four `.ttf`s from
`phoenix/assets/fonts/`; the React panels pull the same four weights from the
Google Fonts CDN in `web/index.html`.
