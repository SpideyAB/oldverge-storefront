# Backend security

## Keys and secrets
| Value | Where it lives | Browser? |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Vercel environment variables (build time) | yes, public by design |
| Supabase secret / service-role key | provided to Edge Functions by Supabase (`SUPABASE_SECRET_KEYS`, legacy `SUPABASE_SERVICE_ROLE_KEY`); in your shell only for `scripts/migrate-assets.mjs` | **never** |
| `TOKEN_SECRET` (>= 32 chars) | `supabase secrets set` | never |
| `ALLOWED_ORIGINS`, `CRON_SECRET`, `ORDER_TEST_MODE`, `TURNSTILE_SECRET_KEY` | `supabase secrets set` | never |

`src/lib/config.js` refuses a `sb_secret_...` or `service_role` key in a `VITE_*` variable. Secrets are never committed (`.env*` and `supabase/functions/.env*` are ignored) and never printed.

## Access matrix (asserted by `supabase/tests/rls.test.js` and `storage.test.js`)
| Actor | Allowed |
|---|---|
| Anonymous | published products/variants, approved public images, public settings, enabled shipping/payment options, published policies; `catalog_availability` (booleans only) and `search_catalog` |
| Guest checkout | only the Edge Functions (rate-limited); no table access; an order is readable only with its capability token |
| Signed-in customer | own profile/addresses (granted columns), own orders (granted columns, no internal flags), own visible events; no writes to orders, items, payments, stock, roles |
| Admin | read operational tables; catalogue/config writes via RLS; every sensitive action through `admin_*` functions that re-check **current** membership (and `aal2` when `require_mfa` is on); no direct writes to inventory, orders, audit log |
| Service role (Edge Functions) | the narrowly granted server RPCs only |

Direct writes to `orders`, `order_items`, `order_events`, `payment_attempts`, `inventory`, `inventory_movements`, `stock_reservations`, refunds/returns, `admin_audit_log` and role membership are denied to every API role. History tables are append-only (trigger).

## Grants and functions
- Migration `...0700` revokes everything, then grants per table and **per column** where needed (RLS does not hide columns).
- Every function in `public`/`private` has EXECUTE revoked from `PUBLIC`, `anon`, `authenticated`; the allow-list is explicit and a test fails if an unexpected function becomes callable by `anon`.
- `SECURITY DEFINER` functions set `search_path = ''`, schema-qualify everything and authorize explicitly. Trigger functions that touch other tables are definers.
- **A new function must add its own REVOKE/GRANT** (Supabase grants new functions to all roles by default).

## Edge Functions
- `verify_jwt = false` on purpose (publishable keys are not JWTs); each function authenticates itself: user session via `auth.getUser`, admin via `is_admin()`, scheduler via `x-cron-secret`.
- Bounded JSON bodies (64 KB), content-type check, unknown fields rejected, generic error codes, `X-Request-Id`, logs contain only request id, code and SQLSTATE.
- Persistent rate limiting (`hit_rate_limit`, Postgres) per endpoint and client hash; **fails closed**. Per-order limiter on `order-status`.
- CORS allow-list from `ALLOWED_ORIGINS`. CORS is not authorization.
- Optional bot check (`TURNSTILE_SECRET_KEY`): **do not set it until a Turnstile widget is added to the storefront forms**, otherwise the forms will be rejected.

## Guest order access
The browser keeps a random checkout secret in `sessionStorage` (only for the attempt). The server derives the access token as `HMAC(TOKEN_SECRET, order id + scope)`, stores only its SHA-256, and returns the token once in the response (recomputed identically on a retry). The confirmation link carries it in the URL **fragment** (never sent to servers or Referer). Order number or email alone unlocks nothing; tokens expire (default 90 days) and an admin can revoke them.

## Uploads
`admin-upload-image` inspects real bytes (JPEG/PNG/WebP only, never SVG/HTML), checks size, dimensions and path, rejects embedded metadata (EXIF/XMP/text chunks), stores in the **private** bucket, never overwrites. `admin-approve-image` requires provenance (source and licence) before an image can reach the public bucket.

## Audit
Admin changes to catalogue, settings, shipping/payment, policies, messages and role membership, plus exports and image rejections, are written to `admin_audit_log` (append-only). Service/system operations are not admin actions.

## Not covered / residual risk
- Hosted Supabase behaviour (platform-added grants, Auth email settings) has not been verified.
- Admin MFA is available (`require_mfa` setting + TOTP) but off by default: turn it on before launch.
- No automated dependency/secret scanning service is enabled.

## Independent review (2026-10-18)
A separate read-only agent reviewed migrations, functions and frontend. Fixed (migration `20261019001000_security_review_fixes.sql`, `_shared/http.js`, `_shared/handlers.js`, `_shared/errors.js`; covered by DB tests):
- Rate-limit key used the client-controlled first `X-Forwarded-For` entry: now `cf-connecting-ip`, else the last hop.
- Added a per-contact limit on `create-order` (8 per hour per email/phone hash) against fake COD orders that tie up stock.
- `admin_approve_image` / `admin_reject_image` reported success on 0 rows (PERFORM resets FOUND): now `ROW_COUNT`; approval also requires the validated public object to exist.
- Admin clients can no longer write to or list `product-public`; only the service role (after byte validation) writes there. Nobody can list it through the API.
- Exact stock (`available`) removed from public error details.
- `site_images` gained an approval guard trigger. `private.get_setting` now reads private settings first, so admins cannot override them through `store_settings`.

Open (accepted for now, must be handled before launch):
- **Turnstile is not wired into the storefront**: `TURNSTILE_SECRET_KEY` is optional because no widget exists yet. Add the widget plus the secret before opening ordering.
- COD orders take stock immediately; with the limits above, fake orders still need an admin to cancel them.
- Newsletter has no double opt-in (needs an email provider), and the unsubscribe token never rotates.
- Possible lock-order deadlock between checkout and admin cancel/payment events (checkout retries once; admin RPCs do not).
- `apply_payment_event` is not tied to the order's payment method (webhook currently returns 501).
- Order-status per-order lookup limit can be spent by anyone who knows the order number.
- Only JPEG EXIF is detected; XMP metadata in other formats may pass.
- A misconfigured production build (bad URL/key) silently runs demo mode; consider failing the build.
- `require_mfa` defaults to false; turn it on in `/admin` Security.
