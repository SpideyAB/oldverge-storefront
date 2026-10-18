<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: status
updated: 2026-10-18
---
# Code Audit 2026-10-18

Full write-up with evidence: `oldv/docs/code-audit.md` (in the repo). This note is the short version.

## How it was done
Four read-only audit agents (architecture and duplication; security and config; frontend behaviour and accessibility; Git, packaging and CI readiness), fixes by the lead, then a separate independent review agent. Nothing was deployed. The Supabase backend was **not** started.

## Fixed
- Privacy policy now matches what the code stores ([[Policies and Contact]]).
- Misleading demo-account notes, track-order stages, silent 9-per-line cap, crash on a malformed URL hash, contact endpoint now https-only, "free from PKR 10,000" wording, shipping progress bar rounding.
- One money formatter (`src/lib/money.js`), one sort function, one `originalPhoto` helper; dead exports removed.
- About 100 kB of dead CSS removed (the old filter sidebar, `.button-volt`, quick view, zipper, cursor ripple, old hero/cart styles). Layout fingerprints of 17 routes at 390/768/1440 px: no element changed style (48 of 51 captures identical; the 3 home captures kept every baseline element and gained carousel loop clones from a running animation loop).
- Rubik font files deleted ([[Colours and Fonts]]).
- An independent review agent then confirmed no secrets, a safe `.gitignore`, valid CI, and no wrongly purged class; its findings (engines range, unused imports hidden by the lint pattern, leftover Tailwind directives, 13 dead keyframes, test coupling, privacy wording) were fixed. Added `.gitignore`, `.gitattributes`, `.env.example`, `.nvmrc`, ESLint, Vitest (33 tests), CI workflow, `CONTRIBUTING.md`, rewritten README and CLAUDE.md. See [[Git and GitHub]].

## Left for the owner or later
Demo delivery numbers in the UI, duplicate `/pages/shipping` vs `/shipping` pages, Tailwind decision, `isContactPublic` gate, Buy now expiry, low-priority accessibility polish, performance polish. All listed in [[Known Issues]] and [[Launch Blockers]].

## Checks run
Lint exit 0, 33 tests pass, build passes, production `npm audit` 0 findings (7 dev-only findings through Tailwind 3), clean-copy `npm ci` + lint + test + build passed. See [[Verification]].

Related: [[Decision Log]] · [[Session Log]] · [[Roadmap]]
