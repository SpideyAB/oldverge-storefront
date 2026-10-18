# Vercel + Supabase deployment

## Verified facts (2026-10-18/19)
- GitHub repository `SpideyAB/oldverge-storefront` (private) is connected to the existing Vercel project **`avme12/oldverge-storefront`**; pushes to a branch create a Vercel preview deployment and report a `Vercel` commit status (checked through the GitHub API).
- Production URL: https://oldverge-storefront.vercel.app/. Before `vercel.json` was added, every route except `/` returned HTTP 404 on direct visit or refresh (no SPA rewrite). `vercel.json` (Vite preset, `npm ci`, `npm run build`, `dist`, rewrite of all paths to `/index.html`; static files are still served first) fixes it on the branch. **It only takes effect on production after the branch is merged and deployed.**
- Preview deployments are behind Vercel Authentication (they answer 302 to a login), so automated checks cannot read them without a protection-bypass token.
- The Vercel plugin command supplied by the owner, `npx plugins add vercel/vercel-plugin`, was verified against Vercel's docs (vercel.com/docs/agent-resources/vercel-plugin) and the `vercel-labs/plugins` npm package. It was run with project scope and telemetry off; Claude Code was not detected by the installer and Bun (a documented prerequisite for its hooks) is not installed, so whether the plugin loaded is **not verified**. Installing it is not proof that GitHub, Vercel or Supabase are connected.

## Environment variables (Vercel, browser-safe only)
| Name | Scope | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | Production, and Preview if a staging project exists | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | same | the publishable key (`sb_publishable_...`) |
Vite inlines these at build time: **change them, then redeploy**. Never put a database password, secret/service-role key, webhook secret or `TOKEN_SECRET` in a Vercel variable; those live in Supabase (`supabase secrets set`). `src/lib/config.js` refuses a secret key in a `VITE_*` variable.

Previews and Development: use a separate staging Supabase project and `ORDER_TEST_MODE=true` on its functions. With only one project, leave the two variables **unset for Preview** (the preview then runs in labelled demo mode and cannot touch production data). Never let a preview create real orders.

## Supabase settings that must match the frontend
- Auth Site URL = the production domain; redirect allow-list = `https://<domain>/account/reset-password` (password recovery route, implemented in `src/pages/live/AuthPages.jsx`) and nothing broader. Add `*.vercel.app` preview URLs only deliberately.
- Edge Function `ALLOWED_ORIGINS` = the same origins (comma separated, exact). CORS is not authorization; it only controls which origins may read responses.
- A custom domain later: update Site URL, redirect list and `ALLOWED_ORIGINS` together, then redeploy.

## Release sequence
1. Database first, **backward compatible**: `supabase db push --dry-run`, then `db push`. 2. Deploy Edge Functions. 3. Set Supabase secrets and Auth settings. 4. Set Vercel variables. 5. Deploy the frontend (branch preview first). 6. Staging smoke test. 7. Promote to production only with the owner's explicit approval. Ordering stays **closed** (`ordering_enabled = false`) until separately approved; a successful deployment is not permission to sell.

## Rollback
Rolling back a Vercel deployment does **not** roll back Postgres or Storage. Migrations here are additive; a destructive migration needs its own down-plan and a backup. To stop taking orders instantly, switch ordering off in `/admin` Settings (or `update ... via admin_set_ordering_enabled(false)`); no deploy is needed. Never run `db reset` on a hosted project and do not run migrations from generic frontend CI.

## Staging smoke test (not yet run)
Home, collection filters/search, product variants, add to bag, checkout validation (with ordering opened on staging only), double click, network failure, price/stock change, refresh of the confirmation link, sign-up/recovery, admin sign-in and permissions, contact success/failure, at 390/768/1440 px, with direct URL visits and refresh on every route.
