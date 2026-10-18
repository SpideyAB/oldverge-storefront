import crypto from 'node:crypto';
import { newUuid, sha256 } from './db.js';

/**
 * Builds a small, fully "ready" store as the database owner (the way a migration or the SQL editor would):
 * two categories, a watch and a quarter zip with verified stock and approved cover images,
 * cash on delivery + one shipping rate, a contact channel and published policies. Ordering is left CLOSED.
 */
export async function seedStore(db) {
  const c = db.main;
  const ids = {};

  const q = async (sql, params) => (await c.query(sql, params)).rows;

  ids.owner = newUuid(); ids.staff = newUuid(); ids.customerA = newUuid(); ids.customerB = newUuid();
  for (const [key, email] of [['owner', 'owner@example.test'], ['staff', 'staff@example.test'], ['customerA', 'a@example.test'], ['customerB', 'b@example.test']]) {
    await q('insert into auth.users (id, email) values ($1, $2)', [ids[key], email]);
  }
  await q("insert into private.admin_members (user_id, role) values ($1, 'owner'), ($2, 'staff')", [ids.owner, ids.staff]);

  ids.catWatches = (await q("insert into public.categories (slug, name) values ('watches', 'Watches') returning id"))[0].id;
  ids.catZips = (await q("insert into public.categories (slug, name) values ('quarter-zips', 'Quarter Zips') returning id"))[0].id;
  ids.brandCasio = (await q("insert into public.brands (slug, name) values ('casio', 'Casio') returning id"))[0].id;

  const addProduct = async (slug, name, categoryId, brandId, kind, variants) => {
    const productId = (await q(
      "insert into public.products (slug, name, category_id, brand_id, kind, style) values ($1, $2, $3, $4, $5, 'Everyday') returning id",
      [slug, name, categoryId, brandId, kind]))[0].id;
    const variantIds = [];
    for (const v of variants) {
      variantIds.push((await q(
        'insert into public.product_variants (product_id, sku, color_name, size_label, price_pkr) values ($1, $2, $3, $4, $5) returning id',
        [productId, v.sku, v.color ?? null, v.size ?? null, v.price]))[0].id);
    }
    await q(
      `insert into public.product_images (product_id, bucket, path, is_cover, approval_status, source_name, licence, alt_text)
       values ($1, 'product-public', $2, true, 'approved', 'Test fixture', 'Test licence', $3)`,
      [productId, `products/${slug}/v1/cover.webp`, name]);
    for (const variantId of variantIds) {
      await q('update public.inventory set on_hand = 5, stock_verified = true, verified_at = now() where variant_id = $1', [variantId]);
    }
    await q("update public.products set status = 'published' where id = $1", [productId]);
    await q('update public.products set ready_to_sell = true where id = $1', [productId]);
    return { productId, variantIds };
  };

  const watch = await addProduct('casio-test', 'Casio Test', ids.catWatches, ids.brandCasio, 'watch', [{ sku: 'CASIO-TEST-OS', size: 'One size', color: 'Silver', price: 16900 }]);
  const zip = await addProduct('zip-test-black', 'Zip Test Black', ids.catZips, null, 'clothing', [
    { sku: 'ZIP-BLK-S', size: 'S', color: 'Black', price: 8490 }, { sku: 'ZIP-BLK-M', size: 'M', color: 'Black', price: 8490 }]);
  ids.watchProduct = watch.productId; ids.watchVariant = watch.variantIds[0];
  ids.zipProduct = zip.productId; ids.zipS = zip.variantIds[0]; ids.zipM = zip.variantIds[1];

  await q("update public.payment_methods set enabled = true where code = 'cod'");
  await q("insert into public.shipping_zones (code, name) values ('pakistan', 'Pakistan')");
  await q("insert into public.shipping_methods (code, label, estimate_text, enabled) values ('standard', 'Standard delivery', '3-5 days', true)");
  await q("insert into public.shipping_rates (method_code, zone_code, price_pkr, free_over_pkr) values ('standard', 'pakistan', 250, 20000)");
  await q("update public.store_settings set value = to_jsonb('hello@example.test'::text) where key = 'contact.email'");
  await q("update public.policy_drafts set sections = '[{\"heading\":\"Test\",\"body\":[\"Test text\"]}]'");
  await q("update public.policy_pages p set published_sections = d.sections, version = 1, published_at = now(), updated_by = $1 from public.policy_drafts d where d.slug = p.slug", [ids.owner]);
  return ids;
}

export async function openOrdering(db) {
  await db.main.query('begin');
  await db.main.query("select set_config('oldverge.ordering_toggle', 'on', true)");
  await db.main.query("update public.store_settings set value = 'true'::jsonb where key = 'ordering_enabled'");
  await db.main.query('commit');
}

export const address = (overrides = {}) => ({
  recipient: 'Test Customer', phone: '+92 300 1234567', line1: '12 Test Street', line2: '', city: 'Lahore', province: 'Punjab', postal_code: '54000', country: 'PK', ...overrides,
});

export const checkoutPayload = (lines, overrides = {}) => ({
  lines, shipping_method: 'standard', payment_method: 'cod',
  contact: { name: 'Test Customer', email: 'customer@example.test', phone: '+92 300 1234567' },
  address: address(), ...overrides,
});

/** Calls public.create_order as the service role, the way the create-order Edge Function does. */
export async function placeOrder(client, { lines, expectedTotal, userId = null, key, secret, payload, isTest = false, tokenHash } = {}) {
  const idempotencyKey = key ?? `key-${crypto.randomUUID()}`;
  const scope = sha256(secret ?? idempotencyKey);
  const token = tokenHash ?? sha256(`token-${idempotencyKey}`);
  await client.query('begin');
  try {
    await client.query('set local role service_role');
    const { rows } = await client.query(
      'select public.create_order($1, $2, $3, $4, $5::jsonb, $6, $7, $8) as r',
      [newUuid(), userId, scope, idempotencyKey, JSON.stringify(payload ?? checkoutPayload(lines)), expectedTotal, token, isTest]);
    await client.query('commit');
    return rows[0].r;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export const stockOf = async (db, variantId) => (await db.main.query('select on_hand, reserved from public.inventory where variant_id = $1', [variantId])).rows[0];
