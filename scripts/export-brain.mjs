// Exports the canonical Obsidian brain (../brain, outside this repo) to docs/brain as a read-only snapshot.
// Usage (from the repo root): node scripts/export-brain.mjs [path-to-brain]
// Only top-level .md notes are copied; .obsidian, Templates, empty notes and anything else are skipped.
// The export stops if a note looks like it contains a secret; personal emails/phone numbers are redacted. Review the diff before committing.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const source = resolve(process.argv[2] || '../brain');
const target = resolve('docs/brain');
const SKIP = new Set(['Untitled.md']);
const SUSPICIOUS = [
  /sb_secret_[A-Za-z0-9_-]{8,}/, /sb_publishable_[A-Za-z0-9_-]{8,}/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/, /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/,
];
// Personal contact data is redacted in the snapshot (it stays in the private brain).
const REDACT = [/[A-Za-z0-9._%+-]+@(?:gmail|yahoo|hotmail|outlook)\.com/gi, /\+?92[\s-]?3\d{2}[\s-]?\d{7}/g];

const notes = readdirSync(source).filter((name) => name.endsWith('.md') && !SKIP.has(name) && statSync(join(source, name)).size > 0);
const problems = [];
const files = notes.map((name) => {
  const text = REDACT.reduce((out, re) => out.replace(re, '<redacted>'), readFileSync(join(source, name), 'utf8'));
  SUSPICIOUS.forEach((re) => { if (re.test(text)) problems.push(`${name}: matches ${re}`); });
  return [name, text];
});
if (problems.length) { console.error('Export stopped, review these notes:\n' + problems.join('\n')); process.exit(1); }

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const banner = '<!-- SNAPSHOT exported from the canonical Obsidian brain (Downloads/oldv/brain). Do not edit here: edit the brain, then run `node scripts/export-brain.mjs`. -->\n';
files.forEach(([name, text]) => writeFileSync(join(target, name), banner + text));
writeFileSync(join(target, 'README.md'), `# Brain snapshot\n\nRead-only export of the owner's Obsidian notes (wiki links like [[Backend]] refer to files in this folder). Canonical source: \`Downloads/oldv/brain\` (outside Git). Regenerate with \`node scripts/export-brain.mjs\` from the repo root, review the diff, commit. Excluded: \`.obsidian\` workspace state, templates, empty notes, secrets and personal data.\n\nStart at [00 Home](00%20Home.md).\n`);
console.log(`Exported ${files.length} notes to docs/brain`);
