<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: status
updated: 2026-10-18
---
# Roadmap (priority order)

1. ~~Publish the audited code and activate CI~~ Done 2026-10-18 (private repo `SpideyAB/oldverge-storefront`, CI green). Minor follow-up: bump `actions/checkout` and `actions/setup-node` majors (Node 20 deprecation annotation) after verifying the tags ([[Git and GitHub]]).
2. **Supabase backend phase** (separate brief): catalogue, variants, inventory, orders, Auth, Storage, Edge Functions, admin area, RLS tests. Integration points are listed in `oldv/docs/code-audit.md` section 10. Not started. Live ordering stays closed.
3. Real product photography, wired via `quarterZipVariants.js` and `products.js` ([[Images]]).
4. Decide the commerce path ([[Checkout and Cart]]).
5. Publish a real contact channel and replace placeholder policy text ([[Policies and Contact]]).
6. Owner decisions from the audit ([[Known Issues]]): demo delivery numbers, canonical shipping/returns pages, Tailwind, contact gate.
7. Low-priority accessibility and performance polish; code splitting.
8. Real-device, Safari/Firefox and screen-reader testing ([[Verification]]).

Requested earlier but not built: real 3D viewer (needs real models), in-page colour image swap, reviews (no verified data), per-size stock filters.
