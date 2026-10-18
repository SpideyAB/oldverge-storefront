<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: status
updated: 2026-10-18
---
# Known Issues

Evidence and detail: `oldv/docs/code-audit.md`. Summary in [[Code Audit 2026-10-18]].

## Open
1. **Photos do not match products** (Casio MTP and Citizen show an Omega dial, Citizen/Orient/Timex reuse photos, quarter-zip colours are off). See [[Images]].
2. No listings or photos for Rolex, Patek Philippe, Cartier, Franck Muller, Best Win ([[Products]]).
3. **Demo delivery numbers** (PKR 250 standard, 600 express, 3-5 and 1-2 working days, free standard delivery from PKR 10,000) appear in the UI as "illustrative". The commerce rules forbid inventing delivery terms but the demo journey was approved. Owner decides whether they stay ([[Commerce Rules]]).
4. `/pages/shipping` and `/pages/returns` duplicate the topics of `/shipping` and `/refund-policy`; the footer links the `/pages/*` versions. Pick one canonical page per topic.
5. Tailwind, PostCSS and Autoprefixer are installed only for Tailwind's base reset (Preflight). Replace the reset to remove them. This also clears the 7 dev-only `npm audit` findings (braces, postcss-selector-parser via tailwindcss 3). Production audit is clean.
6. `siteInfo.isContactPublic()` is unused; the contact page currently shows as a labelled layout preview. Decide gate vs preview.
7. The Buy now item persists in localStorage with no expiry.
8. Sign-in is a demonstration: any valid email and password works.
9. Low-priority accessibility and polish (newsletter error focus, checkout error clearing, repeated announcements, `useDialogFocus` picking the first dialog, filter drawer price swap count, needless re-renders on announcements, FAQ anchor possibly scrolled twice, missing image dimensions on hero/carousel). Full list in the audit doc.
10. JS bundle 571 kB (178 kB gzip), no code splitting.
11. Google Fonts (Cormorant Garamond, Manrope) are a third-party request and need internet. Disclosed in the privacy policy.
12. No 3D viewer exists. Do not call anything 3D.
13. Colour swatches change route, not an in-page image swap.
14. No `robots` meta, favicon or `og:image`.
15. Order ids `OV-DEMO-xxxxxx` can repeat; orders re-price from the live catalogue. Fine for a demo only.

## Resolved
`/account` showing About, `?sort=new`, filters now in the URL, "New Arrivals" link, pictures-not-showing loading fix (2026-10-17); on 2026-10-18: stale privacy policy, false "nothing is saved" account note, track-order stages, silent quantity cap, malformed-hash crash, dead CSS and dead exports, unused Rubik fonts, duplicate money formatter, missing lint/tests/CI/gitignore, stale README/CLAUDE.md.

See also [[Launch Blockers]] · [[Verification]]
