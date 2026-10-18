<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: brand
updated: 2026-10-18
---
# Colours and Fonts

## Core colours (tokens in `src/home.css`)
| Name | HEX | Role |
|---|---|---|
| Ivory | `#F4F0E7` | Main background, theme colour |
| Paper | `#FBF9F4` | Raised surfaces |
| Espresso | `#30251F` | Text, nav, dark surfaces, buttons |
| Olive | `#73765E` | Secondary accent (large text/fills only) |
| Gold | `#9B8155` | Lines, focus (non-text only) |

Supporting: Sand `#E7E1D6` (panels, image wells, `--ov-tile`), Champagne `#D7C6A6` (accent text on espresso), Stone `#655E54` (secondary text), Dust `#D1C7B7`, Cocoa `#514034` (dark button hover).

Contrast: Espresso on Ivory 13.09:1 · Champagne on Espresso 8.88:1 · Stone on Ivory 5.63:1 · Olive on Ivory 4.12:1 (large text only) · Gold on Ivory 3.26:1 (non-text only).

**Not brand** (old theme leftovers): Indigo `#1D1F3A`, Mist, Volt `#C8F135` (lime), Ember, Lilac. The old lime/lilac CSS and the unused colour keys in `ProductArt.jsx` were removed on 2026-10-18 ([[Code Audit 2026-10-18]]).

## Fonts
- Homepage: **Quattrocento** (headlines) + **"OV Helvetica"** (Inter-based stand-in; real Helvetica is licensed and unavailable).
- Header/footer: **Cormorant Garamond + Manrope** (Google Fonts, needs internet; a third-party request disclosed in the privacy policy).
- **Rubik was tried and reverted.** Its stale `rubik-500-*.woff2` files were deleted from `public/fonts/` on 2026-10-18. Remaining files: `quattrocento-400/700`, `ov-sans-300/700`.
- `--ov-ponytail` in `store.css` uses `local('Ponytail')` with a Quattrocento fallback; no licensed file exists.
- Rules: no faux italics, real weights only, Light from 14 px, nothing under 12 px.

Related: [[Brand Identity]] · [[Brand Rules]]
