<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: commerce
updated: 2026-10-18
---
# Checkout and Cart

- Cart lines: `{ productId, size, color, quantity }`. Names, images and prices always come from `products.js` via `resolveLines`; a stored price is never trusted (unit-tested).
- **Quantity cap 9 per line.** Adding past the cap keeps 9 and now says so (`addToCart` returns `capped`); before 2026-10-18 it announced "added".
- Persisted: cart lines, Buy-now item, recent searches (localStorage `oldverge-store-v4`). The demo customer's name, email and phone are in sessionStorage (`ov-demo-customer`). Addresses and orders are memory only and reset on reload.
- **Buy now** uses a separate `directItem` and `/checkout?mode=buy-now`; it never touches the cart (unit-tested and checked in the browser). A cart checkout clears the cart; a Buy now checkout clears nothing else. The Buy now item has no expiry ([[Known Issues]]).
- Money: whole-PKR integers, `src/lib/money.js` (the only formatter and delivery rules). Demo delivery options: standard PKR 250, express PKR 600, free standard delivery from PKR 10,000, taxes not calculated. Estimates are labelled illustrative. Owner decides whether these stay ([[Known Issues]]).
- Checkout and confirmation are demo-labelled: nothing stored or sent, no card fields, no claim that an email was sent. The sign-in accepts any valid email and password and verifies nothing.
- Track order only shows stages for the two sample orders; an order placed in the demo shows no courier progress.
- Surfaces: bag drawer (`CartDrawer.jsx`), `/cart`, `/checkout`, `/order-confirmation`.
- Real checkout, server-side totals and real Auth belong to the Supabase phase ([[Roadmap]]).

Related: [[Commerce Rules]] · [[Routes]]
