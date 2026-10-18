# Backend verification

States are kept separate on purpose: **implemented locally**, **tested locally**, **deployed to preview**, **deployed to production**, **approved for selling**.

| Area | Implemented locally | Tested locally | Preview | Production | Selling |
|---|---|---|---|---|---|
| Schema, RLS, grants, storage policies (9 migrations) | yes | yes (embedded Postgres 17) | no | no | no |
| Checkout (`quote-order`, `create-order`, `place_order`) | yes | yes (DB and handler tests) | no | no | **no, ordering_enabled = false** |
| Edge Functions (11) | yes | handler tests with mocked clients; not run in Deno/Supabase runtime | no | no | no |
| Storefront backend mode | yes | unit tests; browser-checked in **demo mode only** | no | no | no |
| Admin `/admin` | yes | unit + smoke tests; not browser-tested against a live database | no | no | n/a |
| SPA rewrite (`vercel.json`) | yes | build | yes, Vercel builds the branch (SSO-protected) | **no**, production deep links return 404 until merged | n/a |

## Commands and results (2026-10-18)
- `npm run lint`: clean. `npm test`: 14 files, 206 tests passed. `npm run build`: passes (main chunk 890 kB; admin is a separate lazy chunk).
- `npm run test:db`: 9 files, 99 tests passed. Covers: clean migration apply, seed import, RLS as anon / customer A / customer B / admin (direct table and RPC), admin escalation via signup metadata and profile, tampered prices/totals, invalid variants, quantity bounds, concurrent last-item purchase (one wins), concurrent idempotent retry (one order) and payload conflict, cancellation vs expiry race (stock released once), snapshot survival after product/address edits, failed transaction leaves nothing behind, storage bucket policies.

## NOT VERIFIED (needs a hosted or local Supabase stack)
- Edge Functions in the real Supabase runtime (no Supabase CLI or Docker on the build machine).
- Auth email flows (sign-up confirmation, password recovery redirect).
- Storage upload/serve through the real Storage API; asset migration upload (only `npm run assets:dry-run` was run).
- Browser journey in backend mode at 390/768/1440 px.
- Payment webhooks (no provider), email delivery (no provider), real touch swipe, Safari/Firefox, screen readers.
