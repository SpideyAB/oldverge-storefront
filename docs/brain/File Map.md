<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: project
updated: 2026-10-18
---
# File Map

Paths relative to `Downloads\oldv\oldv` (the Git repository).

## Root and tooling
`package.json` / `package-lock.json`, `vite.config.js`, `postcss.config.js`, `tailwind.config.js` (Tailwind only for Preflight), `eslint.config.js`, `.nvmrc`, `.gitignore`, `.gitattributes`, `.env.example`, `.github/workflows/ci.yml`, `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `index.html`. See [[Git and GitHub]].

## Entry and routing
`src/main.jsx`, `src/App.jsx` (routes, redirects, titles), `src/introState.js`, `src/pages.jsx` (HomePage and ShopPage)

## Pages (`src/pages/`)
AboutPage (Our Story), FaqPage, ContactPage, CartPage, CheckoutPage, ConfirmationPage, ProductPage, SearchPage, NotFoundPage, `account.jsx`, `support.jsx` (shipping, returns, track-order)

## Components (`src/components/`)
Shell, CollectionPage, FilterDrawer, CartDrawer, SearchPanel, ContactForm, NewsletterForm, PolicyPage, HomeHero, TiltedGridHero, FeaturedCarousel, ColorExplorer, ProductArt, Reveal, SmoothScroll, BrandLoader, ui.jsx

## Data (`src/data/`)
`products.js` (the only product list), `productBuilders.js`, `productCopy.js`, `productImages.js`, `imageSizes.js`, `quarterZipVariants.js`, `demoListings.js` (empty on purpose), `collections.js` (nav, brand ids, breadcrumbs), `siteInfo.js` (contact = all null, https-only endpoint, page meta), `policies.js`, `faq.js`, `sampleCustomer.js`

## Lib (`src/lib/`)
`money.js` (single price formatter + delivery rules), `collectionFilters.js` (URL filters, `sortProducts`), `scrollLock.js`, `lenisInstance.js`, `search.js`, `useDialogFocus.js`

## Tests
`src/lib/money.test.js`, `src/lib/collectionFilters.test.js`, `src/store.test.js` (32 tests, `npm test`)

## Styles
`src/styles.css` (33 KB legacy base, was 122 KB before the dead-CSS purge), `src/home.css` (current design, ov-* classes), `src/store.css` (shop journey)

## Public
`public/images/` ([[Images]]), `public/fonts/` (Quattrocento, OV Sans = Inter-based stand-in for Helvetica)

## Docs
`docs/project-handover.md` (history), `docs/asset-sources.md` (photo provenance), `docs/code-audit.md` ([[Code Audit 2026-10-18]])

Related: [[Architecture]] · [[Routes]]
