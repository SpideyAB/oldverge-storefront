<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: project
updated: 2026-10-18
---
# Commands

Run inside `Downloads\oldv\oldv`:

```bash
npm ci            # install from lockfile (stop the dev server first on Windows, it locks files)
npm run dev       # dev server
npm run lint      # ESLint, must exit 0
npm test          # Vitest, 33 tests
npm run build     # production build (must pass before saying anything works)
npm run preview   # serve the production build
```

CI runs the same lint, test and build. Verification beyond that is manual: see [[Verification]].

Gotcha: `npm ci` deletes `node_modules` first. If it fails midway (a running dev server locks esbuild on Windows), stop the server and run it again.

Related: [[Stack]] · [[Git and GitHub]]
