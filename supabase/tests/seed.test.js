import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asAnon, asUser, createTestDatabase, newUuid } from './support/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.resolve(here, '../', name), 'utf8');

describe('draft seed import', () => {
  let db;
  beforeAll(async () => {
    db = await createTestDatabase();
    await db.main.query(read('seed.sql'));
  });
  afterAll(async () => { await db.close(); });

  it('imports the sample catalogue as DRAFT with unverified stock and unverified photos', async () => {
    const products = (await db.main.query('select status, ready_to_sell from public.products')).rows;
    expect(products).toHaveLength(10);
    expect(products.every((p) => p.status === 'draft' && p.ready_to_sell === false)).toBe(true);
    expect((await db.main.query('select count(*)::int as n from public.product_variants')).rows[0].n).toBe(6 + 4 * 5);
    expect((await db.main.query('select count(*)::int as n from public.inventory where stock_verified or on_hand <> 0')).rows[0].n).toBe(0);
    const images = (await db.main.query("select distinct approval_status, bucket, licence from public.product_images")).rows;
    expect(images).toEqual([{ approval_status: 'unverified', bucket: 'product-private', licence: 'Unsplash License' }]);
  });

  it('records provenance for every image and leaves the five requested brands without listings', async () => {
    const missing = (await db.main.query("select count(*)::int as n from public.product_images where source_name is null or source_url is null or checksum_sha256 is null")).rows[0].n;
    expect(missing).toBe(0);
    const brands = (await db.main.query("select b.slug, count(p.id)::int as n from public.brands b left join public.products p on p.brand_id = b.id where b.slug in ('rolex', 'patek-philippe', 'cartier', 'franck-muller', 'best-win') group by 1 order by 1")).rows;
    expect(brands.map((b) => b.n)).toEqual([0, 0, 0, 0, 0]);
  });

  it('keeps ordering closed and nothing purchasable, and shows visitors no products or images yet', async () => {
    expect((await db.main.query("select value from public.store_settings where key = 'ordering_enabled'")).rows[0].value).toBe(false);
    expect((await asAnon(db.main, (c) => c.query('select count(*)::int as n from public.products'))).rows[0].n).toBe(0);
    expect((await asAnon(db.main, (c) => c.query('select count(*)::int as n from public.site_images'))).rows[0].n).toBe(0);
    expect((await db.main.query("select count(*)::int as n from public.products where ready_to_sell")).rows[0].n).toBe(0);
  });

  it('is safe to run twice', async () => {
    await db.main.query(read('seed.sql'));
    expect((await db.main.query('select count(*)::int as n from public.products')).rows[0].n).toBe(10);
  });

  it('publishes the existing placeholder policies but leaves them unpublished by an admin, so ordering cannot open', async () => {
    const rows = (await db.main.query('select slug, version, updated_by from public.policy_pages order by slug')).rows;
    expect(rows.every((r) => r.version === 1 && r.updated_by === null)).toBe(true);
    expect((await asAnon(db.main, (c) => c.query('select count(*)::int as n from public.policy_pages'))).rows[0].n).toBe(4);
  });

  it('the optional preview script makes the samples browsable but still not purchasable', async () => {
    await db.main.query(read('seed-demo-publish.sql'));
    expect((await asAnon(db.main, (c) => c.query('select count(*)::int as n from public.products'))).rows[0].n).toBe(10);
    expect((await asAnon(db.main, (c) => c.query("select count(*)::int as n from public.product_images where is_cover"))).rows[0].n).toBe(10);
    const buyable = (await db.main.query("select count(*)::int as n from public.products p join public.product_variants v on v.product_id = p.id join public.inventory i on i.variant_id = v.id where p.ready_to_sell and i.stock_verified")).rows[0].n;
    expect(buyable).toBe(0);
    const ownerId = newUuid();
    await db.main.query("insert into auth.users (id, email) values ($1, 'x@example.test')", [ownerId]);
    const available = (await asUser(db.main, ownerId, (c) => c.query('select * from public.catalog_availability((select array_agg(id) from public.product_variants))'))).rows;
    expect(available.every((row) => row.in_stock === false)).toBe(true);        // unverified stock is never "in stock"
  });
});
