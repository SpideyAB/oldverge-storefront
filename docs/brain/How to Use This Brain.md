<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->
---
type: guide
updated: 2026-10-18
---
# How to Use This Brain

## For Claude Code (rules)
1. **Read first**: before any non-trivial task, read [[00 Home]], then the notes relevant to the task (e.g. [[Brand Rules]] for design, [[Commerce Rules]] for products/copy).
2. **Write after**: at the end of every piece of work, add an entry to [[Session Log]] (date, what changed, files touched, what was verified, what was not).
3. **Record decisions** the user makes in [[Decision Log]] with the reason. Do not reverse a logged decision without asking.
4. **Update, don't duplicate**: if a fact already has a note, edit it. Move resolved items from [[Known Issues]] / [[Launch Blockers]] to the log.
5. **Link everything** with double-bracket wiki links so the graph stays connected.
6. **Never store secrets** (keys, passwords, tokens) here. Names of env vars only.
7. **Only record verified facts**. Mark guesses as "unverified".
8. The code and `docs/project-handover.md` are the source of truth for implementation; this brain is the fast index and the memory of decisions and status.

## For the owner
- Open the vault `Downloads\oldv` in Obsidian. Graph view (left ribbon) shows the connections.
- Add your own notes anywhere in `brain/`. Use the templates in `brain/Templates/`.
- Tell Claude "save this to the brain" and it will file the information in the right note.

## Folder layout
- `brain/` notes (this folder)
- `oldv/` the website code
- `OLDVERGE-brand-identity/` the brand guideline PDF and colour/font sheet
- `.claude/skills/` Claude skills (hidden from Obsidian search)
