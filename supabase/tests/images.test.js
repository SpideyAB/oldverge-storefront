import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from './support/db.js';
import { seedStore } from './support/fixtures.js';
import { makeDeps, tokenFor } from './support/function-deps.js';
import { adminApproveImage, adminUploadImage, inspectImage, MAX_IMAGE_BYTES, validateUpload } from '../functions/_shared/images.js';

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

const png = (w, h, extraChunks = []) => Uint8Array.from([
  0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a,
  ...be32(13), ...ascii('IHDR'), ...be32(w), ...be32(h), 8, 2, 0, 0, 0, 0, 0, 0, 0,
  ...extraChunks.flatMap(([kind, data]) => [...be32(data.length), ...ascii(kind), ...data, 0, 0, 0, 0]),
  ...be32(0), ...ascii('IEND'), 0, 0, 0, 0,
]);
const jpeg = (w, h, { exif = false } = {}) => Uint8Array.from([
  0xff, 0xd8,
  ...(exif ? [0xff, 0xe1, 0x00, 0x0a, ...ascii('Exif'), 0, 0, 0, 0] : [0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
  0xff, 0xc0, 0x00, 0x11, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  0xff, 0xd9,
]);
const webp = (w, h, { exif = false } = {}) => {
  const vp8x = [...ascii('VP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)];
  const extra = exif ? [...ascii('EXIF'), 4, 0, 0, 0, 1, 2, 3, 4] : [];
  const body = [...ascii('WEBP'), ...vp8x, ...extra];
  return Uint8Array.from([...ascii('RIFF'), body.length & 255, (body.length >> 8) & 255, 0, 0, ...body]);
};

describe('image inspection (pure)', () => {
  it('reads type and dimensions from real header bytes, not from the declared type', () => {
    expect(inspectImage(png(800, 600))).toMatchObject({ type: 'image/png', width: 800, height: 600, hasMetadata: false });
    expect(inspectImage(jpeg(1200, 900))).toMatchObject({ type: 'image/jpeg', width: 1200, height: 900, hasMetadata: false });
    expect(inspectImage(webp(960, 1200))).toMatchObject({ type: 'image/webp', width: 960, height: 1200, hasMetadata: false });
  });

  it('flags embedded metadata (EXIF, text chunks) so private data is not published', () => {
    expect(inspectImage(jpeg(100, 100, { exif: true })).hasMetadata).toBe(true);
    expect(inspectImage(webp(100, 100, { exif: true })).hasMetadata).toBe(true);
    expect(inspectImage(png(100, 100, [['tEXt', ascii('Comment\0hello')]])).hasMetadata).toBe(true);
  });

  it('refuses SVG, HTML, scripts, archives and other non-image content', () => {
    const enc = (s) => new TextEncoder().encode(s.padEnd(64, ' '));
    expect(inspectImage(enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(inspectImage(enc('<!doctype html><html><script>x</script></html>'))).toBeNull();
    expect(inspectImage(Uint8Array.from([0x50, 0x4b, 3, 4, ...new Array(40).fill(0)]))).toBeNull();      // zip
    expect(inspectImage(Uint8Array.from([0x4d, 0x5a, ...new Array(40).fill(0)]))).toBeNull();            // Windows executable
    expect(inspectImage(new Uint8Array(10))).toBeNull();
  });
});

describe('upload validation (pure)', () => {
  const ok = (path, type, bytes) => validateUpload(path, type, bytes);
  const fails = async (promise, error) => { await expect(promise).rejects.toMatchObject({ body: { error } }); };

  it('accepts a clean image at an allowed path and records its checksum', async () => {
    const facts = await ok('products/casio-test/v1/cover.webp', 'image/webp', webp(960, 1200));
    expect(facts).toMatchObject({ type: 'image/webp', width: 960, height: 1200 });
    expect(facts.checksum_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects wrong paths, mismatched types, tiny or huge pictures, metadata and oversized files', async () => {
    await fails(ok('../etc/passwd.png', 'image/png', png(100, 100)), 'invalid_path');
    await fails(ok('products/x/../y.png', 'image/png', png(100, 100)), 'invalid_path');
    await fails(ok('/products/x/a.png', 'image/png', png(100, 100)), 'invalid_path');
    await fails(ok('products/x/a.svg', 'image/svg+xml', png(100, 100)), 'invalid_path');
    await fails(ok('products/x/a.png', 'image/jpeg', png(100, 100)), 'type_mismatch');
    await fails(ok('products/x/a.jpg', 'image/jpeg', png(100, 100)), 'type_mismatch');
    await fails(ok('products/x/a.png', 'image/png', png(8, 8)), 'invalid_dimensions');
    await fails(ok('products/x/a.png', 'image/png', png(9000, 100)), 'invalid_dimensions');
    await fails(ok('products/x/a.jpg', 'image/jpeg', jpeg(100, 100, { exif: true })), 'metadata_not_stripped');
    await fails(ok('products/x/a.png', 'image/png', new TextEncoder().encode('<svg onload=alert(1)>'.padEnd(64, ' '))), 'unsupported_image');
    await fails(ok('products/x/a.png', 'image/png', new Uint8Array(MAX_IMAGE_BYTES + 1)), 'payload_too_large');
    await fails(ok('products/x/a.png', 'image/png', new Uint8Array(0)), 'payload_too_large');
  });
});

describe('admin image endpoints', () => {
  let db; let ids; let deps;
  beforeAll(async () => { db = await createTestDatabase(); ids = await seedStore(db); deps = makeDeps(db); });
  afterAll(async () => { await db.close(); });

  const upload = (path, bytes, type, headers = {}) => adminUploadImage(deps)(new Request(`https://f.test/admin-upload-image?path=${encodeURIComponent(path)}`, {
    method: 'POST', headers: { 'content-type': type, 'x-forwarded-for': `10.2.2.${Math.floor(Math.random() * 250)}`, ...headers }, body: bytes,
  })).then(async (r) => ({ status: r.status, body: await r.json() }));

  it('requires a signed-in admin: anonymous, customers and staff-less users are refused', async () => {
    expect((await upload('products/a/v1/c.png', png(100, 100), 'image/png')).status).toBe(401);
    expect((await upload('products/a/v1/c.png', png(100, 100), 'image/png', { authorization: `Bearer ${tokenFor(ids.customerA)}` })).status).toBe(403);
    expect(deps.store.size).toBe(0);
  });

  it('stores a verified upload in the PRIVATE bucket only', async () => {
    const res = await upload('products/new-item/v1/cover.png', png(640, 800), 'image/png', { authorization: `Bearer ${tokenFor(ids.staff)}` });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ bucket: 'product-private', width: 640, height: 800 });
    expect([...deps.store.keys()]).toEqual(['product-private/products/new-item/v1/cover.png']);
    const again = await upload('products/new-item/v1/cover.png', png(640, 800), 'image/png', { authorization: `Bearer ${tokenFor(ids.staff)}` });
    expect(again.status).toBe(409);                                            // never overwritten in place (cache-safe versioned names)
    const bad = await upload('products/new-item/v1/evil.png', new TextEncoder().encode('<svg onload=alert(1)>'.padEnd(64, ' ')), 'image/png', { authorization: `Bearer ${tokenFor(ids.staff)}` });
    expect(bad.status).toBe(415);
  });

  it('publishes an approved image by copying it public first, and rolls the copy back if approval fails', async () => {
    const path = 'products/casio-test/v2/photo.webp';
    deps.store.set(`product-private/${path}`, webp(960, 1200));
    await db.main.query("insert into public.product_images (product_id, bucket, path, source_name) values ($1, 'product-private', $2, 'Test supplier')", [ids.watchProduct, path]);
    const imageId = (await db.main.query('select id from public.product_images where path = $1', [path])).rows[0].id;
    const approve = (headers) => adminApproveImage(deps)(new Request('https://f.test/admin-approve-image', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.3.3.${Math.floor(Math.random() * 250)}`, ...headers }, body: JSON.stringify({ image_id: imageId }),
    })).then(async (r) => ({ status: r.status, body: await r.json() }));
    // No licence recorded: the database refuses, and the public copy is removed again.
    const refused = await approve({ authorization: `Bearer ${tokenFor(ids.staff)}` });
    expect(refused.status).toBe(400);
    expect(deps.store.has(`product-public/${path}`)).toBe(false);
    expect((await db.main.query('select bucket, approval_status from public.product_images where id = $1', [imageId])).rows[0]).toEqual({ bucket: 'product-private', approval_status: 'unverified' });
    await db.main.query("update public.product_images set licence = 'Supplied by owner' where id = $1", [imageId]);
    const done = await approve({ authorization: `Bearer ${tokenFor(ids.staff)}` });
    expect(done).toMatchObject({ status: 200, body: { bucket: 'product-public', path } });
    expect(deps.store.has(`product-public/${path}`)).toBe(true);
    expect((await db.main.query('select bucket, approval_status from public.product_images where id = $1', [imageId])).rows[0]).toEqual({ bucket: 'product-public', approval_status: 'approved' });
    expect((await approve({ authorization: `Bearer ${tokenFor(ids.customerA)}` })).status).toBe(403);
  });
});
