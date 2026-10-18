// Uploads the sample photographs from public/images to Supabase Storage at the paths recorded in supabase/seed.sql.
//
//   node scripts/migrate-assets.mjs                    dry run (default): checks every file, uploads nothing
//   node scripts/migrate-assets.mjs --apply            uploads to the PRIVATE bucket (unapproved drafts)
//   node scripts/migrate-assets.mjs --apply --publish-samples
//                                                      also uploads to the PUBLIC bucket so a preview can show them.
//                                                      Non-production only: needs OLDVERGE_ALLOW_SAMPLE_PUBLISH=yes.
//   --report <file>                                    write the JSON report there (default scripts/out/assets-report.json)
//
// Safe by design: idempotent and resumable (an object that already exists with the same checksum is skipped), it never
// deletes or overwrites anything, and it never touches the source files. The secret key is read ONLY from the shell
// environment (SUPABASE_URL, SUPABASE_SECRET_KEY) and is never printed or written to the report.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const publishSamples = args.includes('--publish-samples');
const reportPath = path.resolve(args.includes('--report') ? args[args.indexOf('--report') + 1] : path.join(root, 'scripts/out/assets-report.json'));

const { inspectImage } = await import(pathToFileURL(path.join(root, 'supabase/functions/_shared/images.js')).href);

const seed = fs.readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8');
const targets = new Set();
for (const m of seed.matchAll(/'product-private', '((?:products|site)\/[^']+)'/g)) targets.add(m[1]);
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const plan = [...targets].sort().map((objectPath) => {
  const file = path.join(root, 'public/images', path.basename(objectPath));
  const item = { objectPath, source: path.relative(root, file), status: 'planned' };
  if (!fs.existsSync(file)) return { ...item, status: 'missing_source' };
  const bytes = fs.readFileSync(file);
  const facts = inspectImage(new Uint8Array(bytes));
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!facts || facts.type !== mime) return { ...item, status: 'rejected_not_a_valid_image' };
  if (facts.hasMetadata) return { ...item, status: 'rejected_has_metadata' };
  return { ...item, status: 'ok', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), width: facts.width, height: facts.height, contentType: mime };
});

const report = { mode: apply ? (publishSamples ? 'apply+publish-samples' : 'apply') : 'dry-run', total: plan.length, items: plan };

if (apply) {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in your shell (never in a file in this repo).'); process.exit(2); }
  if (/^sb_publishable_/.test(key)) { console.error('That is a publishable key. A secret key is required for uploads.'); process.exit(2); }
  if (publishSamples && process.env.OLDVERGE_ALLOW_SAMPLE_PUBLISH !== 'yes') {
    console.error('Refusing to publish sample photographs. Set OLDVERGE_ALLOW_SAMPLE_PUBLISH=yes only for a preview or local project.'); process.exit(2);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const upload = async (bucket, item) => {
    const bytes = fs.readFileSync(path.join(root, item.source));
    const existing = await client.storage.from(bucket).download(item.objectPath);
    if (existing.data) {
      const same = crypto.createHash('sha256').update(Buffer.from(await existing.data.arrayBuffer())).digest('hex') === item.sha256;
      return same ? 'skipped_identical' : 'skipped_different_object_exists';      // never overwrite
    }
    const { error } = await client.storage.from(bucket).upload(item.objectPath, bytes, { contentType: item.contentType, cacheControl: '31536000', upsert: false });
    return error ? `failed: ${error.message}` : 'uploaded';
  };
  for (const item of plan.filter((p) => p.status === 'ok')) {
    item.private = await upload('product-private', item);
    if (publishSamples) item.public = await upload('product-public', item);
  }
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const count = (status) => plan.filter((p) => p.status === status).length;
console.log(`${report.mode}: ${report.total} objects, ${count('ok')} valid, ${count('missing_source')} missing, ${plan.length - count('ok') - count('missing_source')} rejected. Report: ${path.relative(root, reportPath)}`);
process.exit(plan.some((p) => p.status !== 'ok') ? 1 : 0);
