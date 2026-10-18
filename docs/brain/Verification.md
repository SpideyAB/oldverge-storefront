<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: status
updated: 2026-10-18
---
# Verification

## Required before saying something works
1. `npm run lint` exits 0, `npm test` passes, `npm run build` passes.
2. Browser check at **390, 768 and 1440 px**: no horizontal overflow, console clean.
3. Scroll/overlay/route changes: route change, back/forward, drawer open/close with Escape, scroll lock released.
4. State what could not be tested.

## Verified on 2026-10-18 (see [[Code Audit 2026-10-18]])
- Lint exit 0. 33 Vitest tests pass. Build passes (2,049 modules, JS 571 kB / 178 kB gzip, CSS 112 kB / 22 kB gzip, chunk-size warning).
- Production `npm audit`: 0 findings.
- A clean copy of the tracked files (no `node_modules`, `dist`, `.git`, `.claude`) ran `npm ci`, lint, tests and build successfully.
- Computed-style fingerprints of every element on 17 routes at 390/768/1440 px: 48 of 51 identical before and after all CSS changes; on the 3 home captures every baseline element is intact and identical, plus extra carousel loop clones that appeared because the pane's animation loop was running (it was not when the baseline was taken). No element changed style.
- Dev server in the in-app browser: add to bag 10 times caps at 9 with an honest message; Buy now leaves the bag unchanged; search panel and filter drawer open and close with Escape and release scroll lock; `/faq#%E0%A4%A` (malformed hash) loads; console clean; no horizontal overflow.

- **GitHub Actions** (run 39134102607, commit `590ff69`, ubuntu-latest, Node 22): `npm ci`, lint, tests and build all passed in 28 s.

## Never verified
Real touch swipe and touch devices, Safari, Firefox, screen readers, Lighthouse/performance, reduced-motion behaviour of changed code, hover reveals with a real mouse, contact form with a real endpoint, `npm run preview`, real-device behaviour of anything CI cannot see.

Note: the in-app browser pane runs at about 1 fps and is often hidden, so exit animations may not finish there (a filter drawer stayed mounted off-screen after Escape while its scroll lock was released). Confirm layout by measurement, not screenshots alone.

Related: [[Known Issues]] · [[Commands]]
