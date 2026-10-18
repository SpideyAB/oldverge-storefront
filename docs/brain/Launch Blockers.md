<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: status
updated: 2026-10-18
---
# Launch Blockers

Needs the **owner** (Claude cannot invent these). Publishing the code to GitHub does not resolve any of them.
1. **A real contact channel** (email, WhatsApp, form service). The site gives visitors no way to reach the business. [[Policies and Contact]]
2. **Real policy terms** (shipping, returns/refunds, privacy, terms). [[Policies and Contact]]
3. **Correct, owner-approved photography**: five requested watch brands, four colour-matched quarter zips, correct photos for Casio MTP, Citizen, Orient, Timex. Record each in `docs/asset-sources.md`. [[Images]]
4. **Commerce path**: provider or manual flow (WhatsApp/COD), delivery and exchange terms, then real checkout. [[Checkout and Cart]]
5. Real watch listings (model refs, prices) for the five requested brands. [[Products]]
6. Confirmed prices, SKUs and stock.
7. Owner decisions listed in [[Known Issues]]: demo delivery numbers, duplicate shipping/returns pages, Tailwind, contact gate.
8. **Supabase project and keys**: create/authorize a project, set `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel, server secrets in Supabase, first admin. Checklist in `oldv/docs/supabase-setup.md`. [[Backend]]
9. **Payment method and email provider** (COD and/or online provider; sender for order emails). [[Backend]]
10. **Bot protection**: Cloudflare Turnstile widget + `TURNSTILE_SECRET_KEY` before ordering opens (security review). [[Backend]]
11. **Merge approval** for `feature/supabase-backend` (also fixes production 404 on deep links).
12. ~~GitHub account identity and CI~~ Done 2026-10-18: private repo `SpideyAB/oldverge-storefront`, CI green. [[Git and GitHub]]

Technical, no owner input needed: real-device, Safari/Firefox and accessibility testing; performance and code splitting. See [[Roadmap]].
