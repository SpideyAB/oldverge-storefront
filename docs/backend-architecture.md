# Backend architecture

Status: **implemented and tested locally; not deployed**. See `docs/backend-verification.md` for exactly what has and has not been checked.

Supabase is the source of truth for business data, authentication and file storage. The storefront stays a Vite single-page app on Vercel. There is no second database and no custom server.

| Layer | What it does | Where |
|---|---|---|
| Postgres | catalogue, inventory, orders, shipping/payment configuration, support records, audit log; all business rules for stock and totals | `supabase/migrations/*.sql` |
| Auth | customer and admin accounts (email + password, TOTP MFA available) | Supabase Auth, settings in `supabase/config.toml` |
| Storage | product and site images (public bucket for approved images, private bucket for drafts) | migration `...0700_rls_grants_storage.sql` |
| Edge Functions | guest-safe operations: quote, create order, order lookup, contact, newsletter, scheduled jobs, image upload/approval | `supabase/functions/` |
| Browser | reads published data under RLS; manages own account data; admin uses RPCs | `src/lib`, `src/data`, `src/admin`, `src/pages/live` |

## Two explicit modes
`src/lib/config.js` decides once at load time:
- **backend mode**: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set. Every business flow uses Supabase. If it is unreachable the UI shows an error state with retry. It never shows sample data.
- **demo mode**: the variables are unset. The original sample storefront runs, labelled as a demonstration, and stores/sends nothing.
A secret or service-role key in a `VITE_*` variable is detected and refused (demo mode plus a console error).

## Data model (summary)
- Catalogue: `categories`, `brands`, `products` (draft/published/archived + `ready_to_sell`), `product_variants` (SKU, colour, size, price), `product_images` (bucket, path, provenance, approval), `site_images`.
- Inventory: `inventory` (on_hand, reserved, verified flag), immutable `inventory_movements`, `stock_reservations`.
- Customers: `profiles`, `addresses`. Admin membership lives in `private.admin_members`.
- Orders: `orders` (snapshot of contact and address, totals, independent payment and fulfilment state), `order_items` (immutable snapshots), `order_events` (append-only), `order_notes` (admin only), `payment_attempts`, `order_returns`/`order_return_items`/`refunds` (manual records).
- Configuration: `store_settings` (public flag per key), `shipping_zones/methods/rates`, `payment_methods`, `policy_pages` + `policy_drafts`.
- Support: `contact_messages`, `newsletter_subscriptions`, `notification_outbox`, `admin_audit_log`.
- Private schema (not exposed by the Data API): `admin_members`, `settings`, `order_access_tokens` (hashes only), `checkout_requests` (idempotency), `rate_limits`, `webhook_events`.

## Money
Whole PKR in integer columns end to end (database, functions, UI via `src/lib/money.js`). No floating point. Fractional PKR is rejected by the integer types and `quantity`/amount checks. Tax is **not calculated**: orders store `tax_pkr = 0` and `tax_status = 'not_calculated'`, never an "approved zero". If a payment provider needs minor units, convert at that boundary only (no provider is configured).

## Checkout flow (create-order)
1. The browser asks `quote-order` for server-derived totals (per delivery method, once a province is chosen).
2. On "Place order" the browser sends variant ids and quantities, contact, address, the chosen methods, the total it was shown, an **idempotency key** and a **checkout secret** to `create-order`. Prices, totals and statuses in the request are ignored or rejected.
3. The function validates, rate-limits, identifies a signed-in user from the session token, then calls `public.create_order` which, in **one transaction**: checks the ordering switch, resolves the idempotency record, locks inventory rows in variant-id order, expires stale reservations for those variants, recomputes totals from catalogue prices and shipping rules, compares with the total the customer saw (`price_changed` otherwise), writes the order, items, events, stock movement, outbox rows and the guest access hash, and returns the order.
4. A retry with the same key and secret returns the same order and the same access capability. A different payload under the same key is a conflict. Concurrent identical retries produce one order.
5. The confirmation page reads the order back through `order-status` using the capability in the URL **fragment**.

## Stock semantics
- Unknown stock is neither zero nor unlimited: a variant is purchasable only after an admin has confirmed a count (`stock_verified`).
- Cash on delivery (when enabled): stock is removed immediately (`sale` movement), payment stays `unpaid` until an admin records it.
- Online payment (needs a provider adapter, none yet): stock is **reserved** for a bounded window (`reservation_minutes`, default 30); a verified payment commits it, failure/expiry releases it. Expiry runs lazily inside checkout and in `run_maintenance` (schedule it, see setup doc).
- Cancel before shipping: reserved stock is released or committed stock is restocked, at most once per order (guarded by the order row lock and `orders.stock_state`).
- Returned goods are restocked only by an explicit admin action after the return is marked received, once per item.
- A payment that arrives after its reservation was released is flagged `needs_attention`; it is never silently committed (no overselling).

## Lifecycle
Fulfilment: `unfulfilled -> processing -> shipped -> delivered`; `cancelled` only from unfulfilled/processing. Payment: `unpaid | pending | paid | failed | refunded | partially_refunded`, independent of fulfilment. Transitions are enforced in SQL (`admin_set_fulfilment`, `admin_cancel_order`, `apply_payment_event`, ...), not by free-text edits. A refund **record** does not change the order; only an audited confirmation does. Provider refunds and courier APIs are not integrated: shipment and refund confirmations are manual, audited records and are labelled as such.

## Failure recovery
- Lost response after commit: retry with the same key and secret; same order returned.
- Double click: the button locks, and the idempotency key makes a second request a replay.
- Partial storage/database failure (image approval): the public copy is made first, the approval RPC second; if the RPC fails the copy is removed.
- Deadlock/serialization failure: the function layer retries once.
- Provider callbacks: deduplicated by `(provider, event_id)`; amount and currency are checked; late/out-of-order events are ignored or flagged.

## Known limitations
See `docs/backend-verification.md` and `docs/commerce-operations.md`.
