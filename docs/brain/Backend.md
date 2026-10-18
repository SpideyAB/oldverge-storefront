<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: topic
updated: 2026-10-18
---
# Backend (Supabase) index

Supabase Postgres + Auth + Storage + Edge Functions, frontend stays on Vercel. Branch `feature/supabase-backend` in `SpideyAB/oldverge-storefront`. Back to [[00 Home]].

| Topic | Engineering doc (in `oldv/docs/`) |
|---|---|
| Architecture and schema | `backend-architecture.md` |
| Access rules (RLS, grants, functions) | `backend-security.md` |
| Frontend to backend mapping | `frontend-backend-map.md` |
| Environments and deployment | `vercel-supabase-deployment.md`, `supabase-setup.md` |
| Owner operation (`/admin`) | `admin-owner-guide.md`, `commerce-operations.md` |
| Verification | `backend-verification.md` (see also [[Verification]]) |
| Remaining blockers | [[Launch Blockers]] |

## State (verified 2026-10-18, never collapse these into "done")
- **Implemented locally**: yes (9 migrations, 11 Edge Functions, live storefront mode, `/admin`).
- **Tested locally**: yes. 206 unit tests, 99 DB tests on embedded Postgres (RLS, concurrency, idempotency). Edge Functions were not run in the real Supabase runtime.
- **Deployed to preview**: frontend only, in demo mode (Vercel builds the branch; previews are SSO-protected). No Supabase project exists yet.
- **Deployed to production**: no. Production still lacks the SPA rewrite (deep links 404) until the branch is merged.
- **Approved for selling**: **no**. `ordering_enabled = false`.

## Two modes
Demo (no `VITE_SUPABASE_*` set): the sample storefront. Backend (both set): everything from Supabase, with no sample fallback. See [[Architecture]], [[Checkout and Cart]], [[Commerce Rules]].

## Keeping the GitHub snapshot in sync
Canonical notes are here in `brain/`. `oldv/docs/brain/` is an export: run `node scripts/export-brain.mjs` from `oldv/`, review the diff, then commit. Never edit `docs/brain/` directly.
