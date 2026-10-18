<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: commerce
updated: 2026-10-18
---
# Products (sample data, `oldv/src/data/products.js`)

All prices are **samples** (PKR).

## Watches (6)
| Slug | Brand / model | Price | Colour | Style |
|---|---|---|---|---|
| `casio-a168` | Casio Vintage A168 | 16,900 | Silver | Digital |
| `casio-mtp` | Casio MTP-1302 | 24,900 | Blue | Dress |
| `timex-weekender` | Timex Weekender | 28,900 | Black | Field |
| `seiko-5` | Seiko 5 Sports | 74,900 | Black | Sport |
| `citizen-eco-drive` | Citizen Eco-Drive | 89,900 | Blue | Everyday |
| `orient-bambino` | Orient Bambino | 109,000 | Cream | Dress |

## Quarter Zips (4), all 8,490 PKR
`quarter-zip-black` `#262622` · `quarter-zip-beige` `#C7B99F` · `quarter-zip-navy` `#273447` · `quarter-zip-olive` `#656A4B`. Colour swatches navigate to the sibling product (route change, not an in-page swap). Every size S-XXL is listed, which is why no size filter exists.

## Requested brands with NO listings
Rolex, Patek Philippe, Cartier, Franck Muller, Best Win. Collections show "No <brand> watches listed yet." To add one, follow `src/data/demoListings.js` (needs permitted photo, model reference, price).

## Helper files
`productBuilders.js` (`watch`, `quarterZip`), `productCopy.js`, `productImages.js`, `quarterZipVariants.js` (swap-in map for real colour photos, all null), `imageSizes.js`.

## Data problems
Photos do not match listings. See [[Images]] and [[Known Issues]].

Related: [[Commerce Rules]] · [[Routes]]
