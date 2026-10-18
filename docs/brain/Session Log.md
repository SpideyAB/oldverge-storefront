<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: history
updated: 2026-10-18
---
# Session Log

Newest first. Each entry: what changed, files, verified / not verified. Add an entry after every piece of work ([[How to Use This Brain]]). Template: `Templates/Session Entry`.

## 2026-10-18 (later): Supabase backend continued
- Fixed mojibake/BOM in `src/App.jsx` from an earlier agent edit. Lint, 206 unit tests, 99 DB tests and build all pass.
- Committed admin pages, App wiring, seed/asset scripts. Added docs `frontend-backend-map.md`, `admin-owner-guide.md`, `backend-verification.md`; updated `CLAUDE.md` backend section, `.env.example`. New note [[Backend]]; brain export to `oldv/docs/brain/` via `scripts/export-brain.mjs`.
- Independent security review agent: 9 confirmed issues. Fixed 7 (IP spoofing of rate limits, per-contact order limit, image approve/reject false success, public bucket writes/listing, stock count leak, site_images guard, settings override) in migration `20261019001000` plus function changes; DB tests now 100/100. Still open (Turnstile widget, COD stock hold, newsletter double opt-in, others): `oldv/docs/backend-security.md`.
- Browser (demo mode, dev server): 390/768/1440 px, 10 to 13 routes each, no overflow, console clean, back navigation OK, `/admin` shows "needs the Supabase backend".
- Verified: production `/` 200, `/shop` 404 (rewrite not merged). Vercel plugin installed but its MCP needs authorization; no Supabase/Vercel CLI or Docker on this machine. **Not verified**: hosted Supabase, functions in runtime, backend-mode browser journey.

## 2026-10-18/19: Supabase backend phase (WORK IN PROGRESS, usage limit reached)
- **Done and tested locally**: 7 migrations (schema, RLS, grants, checkout, admin ops, storage), 62 DB tests on real embedded Postgres 17 (npm run test:db), 11 Edge Functions with 27 handler tests, supabase/config.toml, storefront data layer (explicit demo vs backend mode), live checkout page, newsletter/contact via functions. Commits d714ca4 and 70b11a0 on branch feature/supabase-backend (pushed, no PR yet).
- **Not done**: App.jsx wiring of live pages, confirmation page, admin and account pages from two parallel agents (not reviewed), seed.sql and asset migration script, hosted Supabase project, Vercel env vars, docs (frontend-backend-map, deployment, owner guide), brain export, independent security review. The last build attempt FAILED (likely an unfinished agent edit): fix before any merge.
- **Vercel**: linked (team avme12, project oldverge-storefront); production had HTTP 404 on every route except / until vercel.json (SPA rewrite) added on the branch; previews are SSO-protected so not checked. Production ordering stays closed.

## 2026-10-18: Code audit, cleanup and Git preparation
- **Asked**: audit the whole app, fix verified issues, consolidate duplicates, safe env handling, lint/tests/CI, publish to a private GitHub repo; also keep the brain updated for every change.
- **Done**: four read-only audit agents, then fixes. Details in [[Code Audit 2026-10-18]] and `oldv/docs/code-audit.md`. Changed: `src/lib/money.js` (single `formatPrice`), `src/store.js` (cap message), `src/data/policies.js` and `src/pages/account.jsx` (honest copy), `SmoothScroll.jsx`, `ContactForm.jsx`, `siteInfo.js`, `support.jsx`, `CartDrawer.jsx`, `ProductPage.jsx`, `FeaturedCarousel.jsx`, `collectionFilters.js`, `SearchPage.jsx`, `CollectionPage.jsx`, dead exports; CSS purge (`styles.css` 122 KB to 33 KB, `home.css`, `store.css`); deleted `public/fonts/rubik-500-*.woff2`.
- **Added**: `.gitignore`, `.gitattributes`, `.env.example`, `.nvmrc`, `eslint.config.js`, `engines`, scripts `lint` and `test`, 3 test files (33 tests), `.github/workflows/ci.yml`, `CONTRIBUTING.md`, `docs/code-audit.md`; rewrote `README.md` and `CLAUDE.md` (fixed encoding and stale claims); banner in `docs/project-handover.md`. Initialised Git at `oldv\oldv` (`main`, nothing committed at the time of this entry).
- **Verified**: lint, tests, build, clean-copy install, 51/51 identical layout fingerprints, browser checks ([[Verification]]).
- **Independent review**: a separate agent reviewed the result; fixed its findings (engines `^22.13.0 || >=24.0.0`, unused imports, `@tailwind components/utilities` removed, 13 dead keyframes, test comments and a positive case, privacy wording, BOM). Layout re-verified: 48/51 fingerprints identical, home baseline intact plus carousel clones.
- **Mistake and recovery**: a clean-copy command ran `npm ci` in the real project folder after a failed `cd`; the dev server locked files, leaving `node_modules` partial. Re-ran `npm ci` with the server stopped; source files were untouched.
- **Committed and published**: staged list reviewed (no env files, archives, large files or secrets), lint, 33 tests and build run first. Owner confirmed the account is SpideyAB and approved installing the GitHub CLI. Installed `gh` with winget, signed in through the device flow (owner approved each GitHub permission screen), created the private repo `SpideyAB/oldverge-storefront`, pushed `main` as `baea942`.
- **Hiccup**: the first push was rejected because the token lacked the `workflow` scope; the approval page froze in the embedded browser (one extra click cancelled a request). Owner chose to push without CI: moved the workflow to `docs/ci/ci.yml`, amended the unpublished first commit, pushed. Docs (README, CLAUDE.md, CONTRIBUTING, audit) say CI is not active yet.
- **CI activated**: the owner approved the `workflow` scope in Chrome (device code), the workflow moved to `.github/workflows/ci.yml` (commit `590ff69`), pushed; GitHub Actions run 39134102607 passed (npm ci, lint, test, build). Annotations: checkout/setup-node v4 on deprecated Node 20, `ubuntu-latest` moving to Ubuntu 26.
- **Not done**: Supabase backend not started ([[Roadmap]]); the 7 owner decisions in [[Known Issues]].

## 2026-10-18: Obsidian brain set up
- Created `brain/` (about 20 notes) in the vault `Downloads\oldv` from `docs/project-handover.md`, `CLAUDE.md`, `docs/asset-sources.md`, the brand colours sheet and the source tree.
- Added a "Second brain" rule to `oldv/CLAUDE.md`. Obsidian ignore filters extended to hide `.claude/`, `rembg-env/`, zips.

## 2026-10-17 and earlier (from handover, summarised)
- Homepage, ribbon hero, carousel, colour explorer built; nav and brand approvals ([[Brand Rules]]).
- Collection navigation, Filter drawer, URL state, shared `CollectionPage`.
- Content pages (FAQ, Our Story, Contact gated), minimal cards and product page, four policies published.
- Backend groundwork written then deleted at owner request.
- Full demo journey: search, cart, checkout, confirmation, account, support pages.
- Photos replaced with Unsplash; cut-outs made with rembg; loading fixes (CSS transitions, eager images).
- Full detail: `oldv/docs/project-handover.md` sections 1-14.
