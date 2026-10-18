<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: project
updated: 2026-10-18
---
# Architecture

- `src/main.jsx` mounts `<BrowserRouter><App/></BrowserRouter>`.
- `src/App.jsx` renders SmoothScroll, Header, animated route content, Footer, CursorRipple, BrandLoader. Theme forced light. Route transitions are keyed by pathname only, so filter changes update in place. Page transitions and reveals use CSS, starting at ~55-60% opacity so images are never invisible.
- Data is static JS in `src/data/` ([[Products]]). `products.js` is the **only** product data.
- Filters live in the URL (`src/lib/collectionFilters.js`), see [[Routes]].
- Scroll: one Lenis instance (`SmoothScroll.jsx`, exposed by `lib/lenisInstance.js`). Overlays use `lib/scrollLock.js` (`useScrollLock`) and carry `data-lenis-prevent`. Never set `overflow` by hand, never add a second scroll loop or `scroll-behavior: smooth`.
- Reveal animation: wrap section content in `<Reveal>`.
- Honour `prefers-reduced-motion` on anything new.
- Money: whole-PKR integers in `src/lib/money.js`, the single formatter and delivery-rule module ([[Checkout and Cart]]).
- CSS: only classes that JSX can emit should have rules. The 2026-10-18 audit purged about 100 kB of dead selectors; do not re-add legacy ones ([[Code Audit 2026-10-18]]).
- Quality gates: ESLint, Vitest, build, CI ([[Git and GitHub]]).

Key components: Shell (Header, Footer, bag drawer, product card), CollectionPage, FilterDrawer, HomeHero, TiltedGridHero, FeaturedCarousel, ColorExplorer, ProductArt, SearchPanel, ContactForm, PolicyPage. Full list: [[File Map]].

Related: [[Stack]] · [[Brand Rules]]
