<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: project
updated: 2026-10-18
---
# Git and GitHub

## Repository boundary
- The Git repository is **`Downloads\oldv\oldv` only** (initialised 2026-10-18, branch `main`). The parent folder is the Obsidian vault and is **not** in the repo: `brain/`, `.obsidian/`, `.claude/`, `OLDVERGE-brand-identity/`, `rembg-env/`, `Claude outputs/` and the zips stay local. Never run `git init` in `Downloads\oldv`.
- Tracked: source, `package-lock.json`, `public/` images and fonts (4 MB, no LFS needed), `docs/`, config, CI, `.env.example`.
- Ignored: `node_modules/`, `dist/`, `.env*` (except `.env.example`), logs, `.claude/`, `.obsidian/`, venvs, archives, future database dumps and exports.

## Git identity on this machine
`git config --global` is `SpideyAB` / `<redacted>`. The owner confirmed in chat (2026-10-18) that **SpideyAB** is the GitHub account that owns the repo.

## GitHub status (2026-10-18)
- **Published.** Private repository **https://github.com/SpideyAB/oldverge-storefront**, branch `main`, two commits: `baea942` "Initial commit: OLDVERGE storefront (audited front end)" and `590ff69` "Add CI workflow (lint, test, build)" (106 tracked files). Local `main` tracks `origin/main`, working tree clean.
- GitHub CLI 2.102 was installed with winget (2026-10-18) and signed in as SpideyAB with scopes `gist`, `read:org`, `repo`, `workflow`. The token lives in the Windows credential store; it was never printed. To push, use `git -c credential.helper= -c "credential.helper=!'C:/Program Files/GitHub CLI/gh.exe' auth git-credential" push` (global Git config was not changed).
- **CI is active and green.** The first push without the workflow was needed because the login lacked the `workflow` scope; the owner then approved that scope in Chrome and `.github/workflows/ci.yml` was added in `590ff69`. Run 39134102607 on that commit passed on Linux with Node 22: `npm ci`, lint, tests, build (28 s). GitHub annotated that `actions/checkout@v4` and `actions/setup-node@v4` run on a deprecated Node 20 runtime (forced to Node 24) and that `ubuntu-latest` moves to Ubuntu 26 on 2026-10-19: bump the action major versions after confirming the newer tags exist.
- The first commit was amended before it was pushed (it was unpublished) to leave the workflow file out; no published history was rewritten.
- No branch protection or paid security features were enabled.

## Workflow
See `oldv/CONTRIBUTING.md`: branch, one focused change, review the diff for secrets, run lint/test/build, commit, push, check CI. No force-push, no rewriting published history, no auto-push hooks.

## Secrets
Names only in `.env.example`. Only public values may use the `VITE_` prefix. A secret/service-role key must never be `VITE_*`. See [[Stack]].

Related: [[Code Audit 2026-10-18]] · [[Commands]]
