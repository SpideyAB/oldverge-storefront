import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createTestDatabase, expectDenied } from './support/db.js';
import { seedStore } from './support/fixtures.js';

describe('storage buckets and policies', () => {
  let db; let ids;
  beforeAll(async () => {
    db = await createTestDatabase();
    ids = await seedStore(db);
    await db.main.query("insert into storage.objects (bucket_id, name) values ('product-public', 'products/a/v1/cover.webp'), ('product-private', 'drafts/secret.webp'), ('order-private', 'orders/receipt.pdf')");
  });
  afterAll(async () => { await db.close(); });

  const names = async (client, role) => (await role(client, (c) => c.query('select bucket_id, name from storage.objects order by name'))).rows;

  it('defines three buckets with the right visibility, size limits and allowed types', async () => {
    const { rows } = await db.main.query('select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id');
    expect(rows.map((r) => [r.id, r.public])).toEqual([['order-private', false], ['product-private', false], ['product-public', true]]);
    const pub = rows.find((r) => r.id === 'product-public');
    expect(pub.allowed_mime_types).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
    expect(pub.allowed_mime_types).not.toContain('image/svg+xml');          // SVG can carry script
    expect(Number(rows.find((r) => r.id === 'product-private').file_size_limit)).toBeGreaterThan(0);
  });

  it('lets nobody list buckets through the API (public images are served by URL); drafts and order files stay private', async () => {
    expect((await names(db.main, asAnon)).map((r) => r.bucket_id)).toEqual([]);
    expect((await names(db.main, (c, fn) => asUser(c, ids.customerA, fn))).map((r) => r.bucket_id)).toEqual([]);
  });

  it('lets admins read and manage product buckets', async () => {
    const all = await names(db.main, (c, fn) => asUser(c, ids.staff, fn));
    expect(all.map((r) => r.bucket_id).sort()).toEqual(['product-private']);   // order-private has no client policy at all
    // Only the service role (admin-approve-image, after validating bytes) may write to the public bucket.
    await expectDenied(asUser(db.main, ids.staff, (c) => c.query("insert into storage.objects (bucket_id, name) values ('product-public', 'unchecked.webp')")));
    await asUser(db.main, ids.staff, (c) => c.query("insert into storage.objects (bucket_id, name) values ('product-private', 'drafts/new.webp')"));
    await asUser(db.main, ids.staff, (c) => c.query("update storage.objects set name = 'drafts/renamed.webp' where name = 'drafts/new.webp'"));
    const removed = await asUser(db.main, ids.staff, (c) => c.query("delete from storage.objects where name = 'drafts/renamed.webp'"));
    expect(removed.rowCount).toBe(1);
  });

  it('rejects uploads, overwrites and deletes from anonymous visitors and customers', async () => {
    await expectDenied(asAnon(db.main, (c) => c.query("insert into storage.objects (bucket_id, name) values ('product-public', 'evil.webp')")));
    await expectDenied(asUser(db.main, ids.customerA, (c) => c.query("insert into storage.objects (bucket_id, name) values ('product-public', 'evil.webp')")));
    await expectDenied(asUser(db.main, ids.customerA, (c) => c.query("insert into storage.objects (bucket_id, name) values ('product-private', 'evil.webp')")));
    await expectDenied(asUser(db.main, ids.customerA, (c) => c.query("insert into storage.objects (bucket_id, name) values ('order-private', 'evil.pdf')")));
    const upd = await asUser(db.main, ids.customerA, (c) => c.query("update storage.objects set name = 'hacked' where bucket_id = 'product-public'"));
    const del = await asUser(db.main, ids.customerA, (c) => c.query("delete from storage.objects where bucket_id = 'product-public'"));
    expect([upd.rowCount, del.rowCount]).toEqual([0, 0]);
    const left = (await db.main.query("select count(*)::int as n from storage.objects where bucket_id = 'product-public'")).rows[0].n;
    expect(left).toBe(1);
    // Even an admin cannot write to the order-private bucket from the browser: signed URLs come from a server function.
    await expectDenied(asUser(db.main, ids.owner, (c) => c.query("insert into storage.objects (bucket_id, name) values ('order-private', 'x.pdf')")));
  });
});
