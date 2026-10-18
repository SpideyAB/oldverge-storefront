# CLAUDE.md — OLDVERGE storefront

Guidance for coding sessions. Full detail: `docs/project-handover.md` (history, append-only) and `docs/code-audit.md` (latest audit).

## Second brain (Obsidian), local only: read first, write last
The owner keeps project memory in an Obsidian vault at `Downloads/oldv` with notes in `Downloads/oldv/brain/` (this repo is `Downloads/oldv/oldv`, so the notes are at `../brain/`). The vault is **not part of this repository**. If `../brain/` does not exist (for example on a fresh clone), skip this section.
- Before any non-trivial task, read `../brain/00 Home.md` and the notes relevant to the task (design: `Brand Rules`; products/copy: `Commerce Rules`, `Products`; status: `Known Issues`, `Launch Blockers`).
- After every piece of work, add an entry to `../brain/Session Log.md` (what changed, files, verified / not verified). Log owner decisions in `../brain/Decision Log.md` with the reason; update `Known Issues`, `Launch Blockers`, `Roadmap` and topic notes instead of duplicating facts.
- When the owner says "save this", "remember this" or "add to the brain", file it in the right note and link it with wiki links.
- Never put secrets in the brain. Mark unverified facts as unverified. Rules: `../brain/How to Use This Brain.md`.

## Purpose
OLDVERGE is a watch and menswear brand (Pakistan, prices in PKR). This repo is a **front-end store preview** with a demo shopping journey. Orders are **not open**. All prices are samples.

## Verified stack (from `package.json`, lockfile, and code)
- React 19 + Vite 6 (`@vitejs/plugin-react`), plain JS/JSX (no TypeScript), npm (`package-lock.json`). `engines.node` is `^22.13.0 || >=24.0.0` (ESLint 10 and Vitest 5 need it; the production build itself also works on Node 20.19+); CI uses Node 22 (`.nvmrc`).
- Routing: `react-router-dom` 7, `BrowserRouter` in `src/main.jsx`. Static hosts must rewrite every path to `index.html`.
- State: `zustand` 5 (`src/store.js`). Only the cart lines, the Buy now item and recent searches persist (localStorage `oldverge-store-v4`). The demo customer's name/email/phone sit in sessionStorage (`ov-demo-customer`); addresses and orders are memory only.
- Motion: `framer-motion` 12 (carousel/hero). Smooth scrolling is `lenis` (one instance in `SmoothScroll.jsx`, `autoRaf`, touch stays native, off under reduced motion). Entrance reveals are `Reveal.jsx`.
- Icons: `lucide-react`.
- Styling: **hand-written CSS**: `src/styles.css` (small legacy base), `src/home.css` (current design), `src/store.css` (shop journey). Tailwind 3.4 + PostCSS are installed and only `@tailwind base` is loaded (Preflight, the base reset the layout relies on). **No Tailwind utility classes are used.** Do not write Tailwind utilities, and do not remove the directives, without agreeing it first (see `docs/code-audit.md`).
- Backend: Supabase (see Backend section). Env vars read: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, optional `VITE_CONTACT_FORM_ENDPOINT` (demo mode only). See `.env.example`.
- Quality gates: `npm run lint` (ESLint flat config), `npm test` (Vitest, unit tests for money, filters and store), `npm run build`. CI: `.github/workflows/ci.yml`.

## Commands
- `npm ci` (use the lockfile) · `npm run dev` · `npm run lint` · `npm test` · `npm run build` · `npm run preview`

## Directories
- `src/App.jsx` routes and redirects, `src/main.jsx` entry, `src/pages.jsx` HomePage and ShopPage (ShopPage only validates the category and renders the shared `CollectionPage`).
- `src/pages/` Faq, About, Contact, Cart, Checkout, Confirmation, Product, Search, NotFound, `account.jsx`, `support.jsx` (shipping/returns/track order).
- `src/components/` Shell (Header with dropdowns, Footer, product card), CollectionPage, FilterDrawer, CartDrawer, SearchPanel, ContactForm, NewsletterForm, PolicyPage, HomeHero, TiltedGridHero, FeaturedCarousel, ColorExplorer, ProductArt, Reveal, SmoothScroll, BrandLoader, ui.jsx. Product cards are links only (no quick view).
- `src/data/` `products.js` (**the only product data**), `productBuilders.js`, `demoListings.js` (empty on purpose), `collections.js` (routes, brand ids, nav, breadcrumbs), `quarterZipVariants.js` (swap-in map for real colour photos), `siteInfo.js` (contact details, all null; page meta), `faq.js`, `policies.js`, `imageSizes.js`, `productImages.js`, `productCopy.js`, `sampleCustomer.js`.
- `src/lib/` `money.js` (**the only price formatter and delivery rules**), `collectionFilters.js` (URL <-> filter state, `sortProducts`), `scrollLock.js` (shared scroll lock: use it, never set `overflow` by hand), `search.js`, `lenisInstance.js`, `useDialogFocus.js`.
- `public/images/` photos, `public/fonts/` self-hosted fonts. `docs/asset-sources.md` records photo provenance.

## Conventions
- Class names: `ov-*` for current design. Only classes that JSX actually emits should have CSS (the dead-CSS purge of 2026-10-18 removed the rest; do not re-add legacy selectors).
- Tokens in `home.css`: `--ov-espresso #30251F`, `--ov-ivory #F4F0E7`, `--ov-paper #FBF9F4`, `--ov-champagne #D7C6A6`, `--ov-sand #E7E1D6`, `--ov-stone #655E54`, `--ov-gold #9B8155`, `--ov-olive #73765E`.
- Wrap section content in `<Reveal>` for entrance animation. Overlays (drawer, modal, menu) must call `useScrollLock` and carry `data-lenis-prevent`.
- One scroll system: Lenis from `SmoothScroll.jsx`. Do not add a second instance, another rAF scroll loop or `scroll-behavior: smooth`.
- Honour `prefers-reduced-motion` on anything new.
- Only `VITE_*` public values may reach the browser. Never put a secret in a `VITE_*` variable.

## Brand constraints (approved current state, do not revert)
- Fonts: homepage Quattrocento + "OV Helvetica" (Inter-based stand-in); header/footer Cormorant Garamond + Manrope. **Rubik was tried and reverted** (its font files were deleted).
- Nav colour espresso `#30251F`. No banner above the nav. No theme button in the nav. Theme is forced light. The header has a search button that opens the search panel.
- Hero H1 is "Timeless Elegance"; the large OLDVERGE heading was removed on purpose.
- Main categories: Watches and Clothes. "Clothes" is the label; route is `/shop/quarter-zips`. Clothes contains Quarter Zips only; do not add other clothing categories.
- Header nav: Watches (All Watches, Rolex, Patek Philippe, Cartier, Franck Muller, Best Win), Clothes (Quarter Zips), Our Story. "Best Win" is the supplied name; do not rename it. No "New Arrivals" link: there is no date data to sort by.
- Elegant, minimal, photo-first, subtle motion.

## Collections and URLs
- Routes: `/shop`, `/shop/watches`, `/shop/quarter-zips`, `/product/:slug`. Watch brands: `/shop/watches?brand=<id>` (id = slugified brand, e.g. `patek-philippe`). Unknown `/shop/<x>` shows the 404 page.
- The URL is the only source of truth for filters: `brand`, `style`, `colour` (repeatable), `price_min`, `price_max`, `sort` (`price-asc`, `price-desc`; default featured). The Filter drawer edits a draft and writes the URL on Apply. Params that do not apply to the collection are ignored. `sort=new` is not supported (no date data).
- A filter is only offered when the data can support it (`getFacets`). Quarter-zip size is hidden because every product lists every size. Do not add stock or availability filters without real data.
- The All/Watches/Clothes switcher links restore each category's last query (sessionStorage `ov-shop-state`); opening a URL directly always wins.
- Route transitions are keyed by pathname only, so filter changes update the page in place.

## Content pages and copy
- One site-wide notice lives in the footer: "Displayed prices are samples. Orders are not open yet." Do not repeat it on every page; keep only short statements next to the action they explain (product page, bag, checkout).
- `/contact` is a layout preview until a real channel exists: `siteInfo.contact` is all null and `VITE_CONTACT_FORM_ENDPOINT` is unset, so the form is labelled demo-only and sends nothing. The endpoint is accepted only if it is an `https:` URL. Never simulate a successful submission or show invented contact details.
- The four policy pages (Shipping, Returns & Refunds, Privacy, Terms) are in `src/data/policies.js` and linked from the footer. Shipping and Returns say only that no orders are accepted yet; replace their text with the owner's real terms. Never invent delivery, return, refund or legal terms. The Privacy text must match what the code stores (it was corrected on 2026-10-18; re-check it whenever storage or forms change).
- Product cards are the photograph, then name and price on one line. No buttons, badges or text on top of a photo.
- Product page follows the Hanger reference: large photo at its own proportions on the left, name and price on one row, colour/size, Add to bag, Buy now, description. Keep text minimal.
- Do not describe the site as a demo or preview in the interface beyond the footer notice and the cart/checkout statements.

## Design skills (local, not in this repo)
- The owner's `Downloads/oldv/.claude/skills/` holds UI UX Pro Max and context-engineering skills. Their suggestions never override the OLDVERGE identity: the "Liquid Glass" style recommendation was rejected as not minimal.

## Backend (Supabase, branch `feature/supabase-backend`)
- Two explicit modes (`src/lib/config.js`): demo when `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` are unset (the sample storefront described below), backend when both are set. Backend failures show an error state and never fall back to sample data.
- Schema/RLS in `supabase/migrations`, Edge Functions in `supabase/functions`, DB tests `npm run test:db` (embedded Postgres). Admin at `/admin` (`src/admin`, lazy chunk).
- Docs: `docs/backend-architecture.md`, `backend-security.md`, `supabase-setup.md`, `vercel-supabase-deployment.md`, `frontend-backend-map.md`, `admin-owner-guide.md`, `commerce-operations.md`, `backend-verification.md`. Brain snapshot: `docs/brain/` (export only; edit `../brain/`).
- `ordering_enabled` stays false until the owner approves selling. Secrets only in Supabase secrets, never `VITE_*`.

## Storefront journey (owner-approved demo, 2026-10-17)
Frontend only: no real payment, orders, email or auth.
- Routes: `/shop`, `/shop/:category`, `/product/:slug`, `/cart`, `/checkout`, `/order-confirmation`, `/search`, `/account/*`, `/about`, `/faq`, `/contact`, `/pages/shipping|returns|track-order`, policies at `/shipping`, `/refund-policy`, `/privacy-policy`, `/terms-and-conditions`. Shopify-style aliases redirect (`/collections/*`, `/products/*`, `/pages/about|faq|contact`, `/policies/*`). `/wishlist` redirects to `/shop`; `/size-guide` redirects to `/faq#sizing`.
- Cart lines are `{ productId, size, color, quantity }`; names, images and prices always come from `products.js` (`resolveLines`). "Buy now" uses a separate `directItem` and `/checkout?mode=buy-now`; it never touches the cart. A cart checkout clears the cart; a Buy now checkout clears nothing else. Quantity per line is capped at 9 and the UI says so.
- Money: whole-PKR integers, `src/lib/money.js` (demo delivery options, PKR 10,000 free-standard-delivery threshold, taxes not calculated). No discount codes or invented promotions.
- The checkout collects contact and address fields only to show the confirmation; nothing is stored or sent, and there are no card fields. Every demo form is labelled as a demo and never claims a message or email was sent. The sign-in is a demonstration: any valid email and password works and nothing is verified.
- Stock is unknown: nothing is sold out unless a product has `soldOut` or `unavailableSizes`. Never invent stock.
- Wishlist/"Save for later" was removed on purpose.
- Ponytail: `--ov-ponytail` in `store.css` uses `local('Ponytail')` with a Quattrocento fallback. No licensed file exists; add `public/fonts/ponytail-regular.woff2` and a `url()` source to bundle it.

## Commerce rules
- Never invent products, prices, reviews, stock, discounts, delivery terms or payment methods.
- Keep the footer notice and the demo labels on checkout. Never add card fields or real payment until a provider is integrated.
- Never label a photo as a brand it does not show. Requested brands without verified photos/model data stay as an empty collection (`src/data/demoListings.js`).
- Do not replace real photos with placeholders. Illustrations in ColorExplorer are labelled stand-ins; replace them with real photos via `quarterZipVariants.js`.
- Never print or commit secrets. Document env var names only.

## Verification requirements
Before saying something works: `npm run lint`, `npm test`, `npm run build`, then check in a browser at 390, 768 and 1440 px (no horizontal overflow, console clean). For scroll, overlay or route changes, test route change, back/forward, and drawer open/close. State what you could not test (real touch swipe, Safari/Firefox, screen readers were never tested).

## Git workflow
See `CONTRIBUTING.md`. Stage intended paths only, check the staged diff for secrets and generated files, never force-push or rewrite published history.

## Known limitations
See `docs/code-audit.md` and `docs/project-handover.md` section 8. Key ones: no real product photos (all images are Unsplash stand-ins that only approximate product names and colours; some watch dials show another brand's text; only `watch-casio-a168.jpg` is a close match); no listings or photos for Rolex, Patek Philippe, Cartier, Franck Muller, Best Win; no 3D viewer; no contact channel and no real shipping/returns terms (launch blockers).
