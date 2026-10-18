# Frontend to backend map

Two explicit modes (`src/lib/config.js`). **Demo** runs when `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are unset: the original labelled sample storefront, nothing stored or sent. **Backend** runs when both are set: every row below uses Supabase. A backend failure shows an error or unavailable state (`BackendGate`). It never falls back to sample data.

Status key: **L** = implemented and covered by local tests (unit and/or embedded-Postgres DB tests). **NOT VERIFIED HOSTED** applies to every row until a Supabase project is linked (see `docs/backend-verification.md`).

| Surface (route / component) | User action | Source | Authorization | Loading / empty / error | Evidence |
|---|---|---|---|---|---|
| Home `/` (`HomePage`, `FeaturedCarousel`, `ColorExplorer`) | View featured products | `products` (status=published) + `product_variants` + `product_images` (bucket `product-public`), via `src/data/catalog.js` | anon SELECT on published rows only (RLS) | `BackendGate` spinner, error with retry; empty catalogue shows no cards | L (`catalogMapper.test.js`, `rls.test.js`) |
| Collections `/shop`, `/shop/:category` | Filter / sort via URL | same catalogue store, filtered client-side (bounded 500 rows, `CATALOG_LIMIT`) | anon | Honest empty state for brands with no listings (Rolex, Patek Philippe, Cartier, Franck Muller, Best Win) | L (`collectionFilters.test.js`) |
| Search `/search`, `SearchPanel` | Text search | loaded published catalogue | anon | "No results" state | L. Search runs on the loaded catalogue, not a server query (fine at under 500 products) |
| Product `/product/:slug` | Pick colour/size, add to bag | variant id from `product_variants`; advisory stock from RPC `catalog_availability` (in stock / low / out, no exact counts) | anon EXECUTE on that RPC only | Unknown or unconfirmed stock = not purchasable | L |
| Cart drawer / `/cart` | Change quantity, remove | localStorage: variant id and quantity only. Price is re-read from the catalogue and re-quoted by `quote-order` | none (local) | Unavailable lines are explained, never priced from storage | L (`store.test.js`) |
| Buy now `/checkout?mode=buy-now` | Direct single item | separate direct-item state; does not touch the cart | none until submit | as checkout | L |
| Checkout `/checkout` (`LiveCheckoutPage`) | Review, then place order | Edge Functions `quote-order` (server totals), then `create-order` (Postgres function `place_order`, one transaction, idempotency key) | anon/customer via function only; no direct table writes | Totals shown only from the server quote. A price or delivery change forces re-confirmation. Ordering closed shows "ORDERING IS NOT CONFIGURED" | L (`checkout.test.js` DB, `functions.test.js`, `checkout.test.js` unit) |
| Confirmation `/order-confirmation` (`LiveConfirmationPage`) | View or refresh order | `order-status` function with hashed guest token (fragment), or own order via RLS when signed in | token or owner | Expired or invalid token shows a neutral message; no local fake confirmation | L |
| Account `/account/*` (`src/pages/live`) | Sign up/in/out, reset password, profile, addresses, orders | Supabase Auth; `profiles`, `addresses`, `orders` (safe columns) | own rows only (RLS) | Expired session sends you to sign in; empty lists are honest | L (`rls.test.js` customer A vs B) |
| Track order `/pages/track-order` | Look up an order | signed in: own orders; guest: confirmation link token via `order-status` | no lookup by order number plus email | Neutral "not found" (no enumeration) | L |
| Contact `/contact` (`ContactForm`) | Send message | `submit-contact` function, then private `contact_messages` | function only; persistent rate limit | "Saved" (not "emailed"); error keeps the text | L |
| Newsletter (`NewsletterForm`) | Subscribe / unsubscribe | `newsletter-subscribe` / `newsletter-unsubscribe` | consent required; response does not disclose existing subscribers | "Saved subscription"; no claim that campaigns run | L |
| Policies (`PolicyPage`) | Read | `policy_pages` (published versions) | anon SELECT published | Drafts never public | L |
| Returns `/pages/returns` | Ask about a return | `submit-contact` (topic return) | as contact | as contact | L |
| Admin `/admin/*` | See `docs/admin-owner-guide.md` | admin RPCs (`admin_*`), RLS admin policies, functions `admin-upload-image`, `admin-approve-image` | `is_admin()` membership checked in the database on every call | Each page has loading, error and retry states | L (`rls.test.js`, `lifecycle.test.js`, `smoke.test.jsx`) |

## Disabled until the owner supplies something
| Action | Missing |
|---|---|
| Placing any order | `ordering_enabled` is false. Needs verified products, stock, shipping, an approved payment method and policies. Readiness: `/admin` Settings |
| Online payment | No provider chosen. `payment-webhook` is a disabled adapter |
| Order and admin emails | No email provider. `process-outbox` records intent and marks it failed/pending; nothing claims sent |
| Courier API | None. Tracking numbers are entered by hand |

Purely local UI (navigation, motion, drawers, filters, the quick view) writes nothing, by design.
