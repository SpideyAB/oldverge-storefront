<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: project
updated: 2026-10-18
---
# Stack

Verified from `oldv/package.json` and code.

| Layer | Choice | Notes |
|---|---|---|
| UI | React 19, plain JS/JSX | No TypeScript |
| Build | Vite 6 + `@vitejs/plugin-react` | npm, lockfile `package-lock.json`; `engines.node` `^22.13.0 \|\| >=24.0.0` (lint/tests need it; build alone works on 20.19+), `.nvmrc` 22 |
| Routing | `react-router-dom` 7 | `BrowserRouter`; static hosts must rewrite all paths to `index.html` |
| State | `zustand` 5 (`src/store.js`) | localStorage `oldverge-store-v4`: cart lines, Buy-now item, recent searches. sessionStorage: demo customer name/email/phone, shop filter memory, scroll positions, intro flag |
| Motion | `framer-motion` 12, `lenis` 1.3 | One Lenis instance in `SmoothScroll.jsx`; touch stays native; off under reduced motion |
| Icons | `lucide-react` | |
| Styling | Hand-written CSS: `styles.css` (33 KB legacy base), `home.css`, `store.css` | Tailwind + PostCSS installed **only for `@tailwind base` (Preflight reset)**, no utility classes; the components/utilities directives were removed. Dead CSS purged 2026-10-18 |
| Lint / tests | ESLint (flat config), Vitest | 33 unit tests: money, collection filters, cart/Buy now store |
| CI | GitHub Actions `ci.yml` | lint, test, build; read-only token |
| Backend | None | Supabase phase is separate and not started, see [[Decision Log]] |

Env variable read by code: `VITE_CONTACT_FORM_ENDPOINT` (optional, https only). `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are reserved, not read. See [[Git and GitHub]].

`npm audit`: production 0 findings; 7 dev-only findings via `tailwindcss` 3 ([[Known Issues]]). Verified on Node 24.19 / npm 11.17; the older notes cite Node 22.22.

Related: [[Architecture]] · [[Commands]] · [[Brand Rules]] · [[Code Audit 2026-10-18]]
