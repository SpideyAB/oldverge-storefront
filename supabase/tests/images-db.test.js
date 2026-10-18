import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDatabase, expectOvError } from './support/db.js';
import { seedStore } from './support/fixtures.js';

describe('image approval integrity', () => {
  let db; let ids; let imageId;
  beforeAll(async () => {
    db = await createTestDatabase();
    ids = await seedStore(db);
    imageId = (await db.main.query("insert into public.product_images (product_id, bucket, path, source_name, licence) values ($1, 'product-private', 'drafts/a.webp', 'Supplier', 'Owned') returning id", [ids.watchProduct])).rows[0].id;
  });
  afterAll(async () => { await db.close(); });

  const asStaff = (fn) => asUser(db.main, ids.staff, fn);

  it('refuses a direct table write that approves an image, moves it public or forges approval metadata', async () => {
    const attempt = (sql, params = []) => expect(asStaff((c) => c.query(sql, params))).rejects.toThrow(/image_approval_via_function_only/);
    await attempt("update public.product_images set approval_status = 'approved' where id = $1", [imageId]);
    await attempt("update public.product_images set bucket = 'product-public' where id = $1", [imageId]);
    await attempt('update public.product_images set approved_by = $2 where id = $1', [imageId, ids.staff]);
    await attempt("insert into public.product_images (product_id, bucket, path, approval_status) values ($1, 'product-public', 'x/y.webp', 'approved')", [ids.watchProduct]);
    await attempt("insert into public.product_images (product_id, bucket, path, approval_status) values ($1, 'product-private', 'x/z.webp', 'approved')", [ids.watchProduct]);
    const row = (await db.main.query('select bucket, approval_status from public.product_images where id = $1', [imageId])).rows[0];
    expect(row).toEqual({ bucket: 'product-private', approval_status: 'unverified' });
  });

  it('still lets an admin edit provenance and alt text, and add unverified private drafts', async () => {
    await asStaff((c) => c.query("update public.product_images set alt_text = 'Edited', licence = 'Owned by us' where id = $1", [imageId]));
    await asStaff((c) => c.query("insert into public.product_images (product_id, bucket, path) values ($1, 'product-private', 'drafts/b.webp')", [ids.watchProduct]));
  });

  it('approves only through the function, and only an approved image can be the cover (atomically)', async () => {
    await expectOvError(asStaff((c) => c.query('select public.admin_set_cover_image($1)', [imageId])), 'image_not_approved');
    await expectOvError(asStaff((c) => c.query("select public.admin_approve_image($1, 'products/casio-test/v2/a.webp')", [imageId])), 'public_copy_missing');
    await db.main.query("insert into storage.objects (bucket_id, name) values ('product-public', 'products/casio-test/v2/a.webp')");
    await asStaff((c) => c.query("select public.admin_approve_image($1, 'products/casio-test/v2/a.webp')", [imageId]));
    await expectOvError(asStaff((c) => c.query('select public.admin_reject_image($1)', [imageId])), 'not_found');   // already public: no silent success
    expect((await db.main.query('select bucket, approval_status from public.product_images where id = $1', [imageId])).rows[0]).toEqual({ bucket: 'product-public', approval_status: 'approved' });
    await asStaff((c) => c.query('select public.admin_set_cover_image($1)', [imageId]));
    const covers = (await db.main.query('select id from public.product_images where product_id = $1 and is_cover', [ids.watchProduct])).rows;
    expect(covers).toEqual([{ id: imageId }]);                       // exactly one cover, switched in one statement
    const afterLock = await asStaff((c) => c.query("update public.product_images set approval_status = 'unverified' where id = $1", [imageId])).catch((e) => e);
    expect(afterLock.message).toMatch(/image_approval_via_function_only/);
  });

  it('validates order notes with a clear error', async () => {
    const order = (await db.main.query("select 1")).rows;
    expect(order).toHaveLength(1);
    await expectOvError(asStaff((c) => c.query("select public.admin_add_order_note($1, '   ')", ['00000000-0000-4000-8000-000000000000'])), 'invalid_request');
    await expectOvError(asStaff((c) => c.query("select public.admin_add_order_note($1, 'hello')", ['00000000-0000-4000-8000-000000000000'])), 'not_found');
  });
});
