import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asAnon, asService, createTestDatabase, errorCode, expectOvError, sha256 } from './support/db.js';
import { checkoutPayload, openOrdering, placeOrder, seedStore, stockOf } from './support/fixtures.js';

describe('checkout: quote and atomic order creation', () => {
  let db; let ids;
  beforeAll(async () => { db = await createTestDatabase(); ids = await seedStore(db); });
  afterAll(async () => { await db.close(); });

  const resetStock = async () => {
    await db.main.query('update public.inventory set on_hand = 5, reserved = 0 where variant_id = any ($1)', [[ids.watchVariant, ids.zipS, ids.zipM]]);
  };
  const lines = (variantId, quantity) => [{ variant_id: variantId, quantity }];

  it('refuses everything while ordering is closed (the default)', async () => {
    await expectOvError(placeOrder(db.main, { lines: lines(ids.zipM, 1), expectedTotal: 8740 }), 'ordering_closed');
    await expectOvError(asService(db.main, (c) => c.query('select public.quote_order($1::jsonb, $2, $3, $4)', [JSON.stringify(lines(ids.zipM, 1)), 'standard', 'Punjab', 'cod'])), 'ordering_closed');
  });

  describe('with ordering open', () => {
    beforeAll(async () => { await openOrdering(db); });
    beforeEach(async () => { await resetStock(); await db.main.query('delete from private.checkout_requests'); });

    const quote = async (variantLines, extra = {}) => (await asService(db.main, (c) => c.query(
      'select public.quote_order($1::jsonb, $2, $3, $4) as q',
      [JSON.stringify(variantLines), extra.shipping ?? 'standard', extra.province ?? 'Punjab', extra.payment ?? 'cod']))).rows[0].q;

    it('derives totals on the server from catalogue prices and the shipping rule', async () => {
      const q = await quote([...lines(ids.zipM, 2), ...lines(ids.zipM, 1)]);   // duplicate lines are merged
      expect(q.lines).toHaveLength(1);
      expect(q.lines[0].quantity).toBe(3);
      expect(q.subtotal_pkr).toBe(8490 * 3);
      expect(q.shipping_pkr).toBe(0);                  // free over 20,000
      expect(q.total_pkr).toBe(8490 * 3);
      expect(q.tax_status).toBe('not_calculated');
      const small = await quote(lines(ids.zipM, 1));
      expect(small.shipping_pkr).toBe(250);
      expect(small.total_pkr).toBe(8740);
    });

    it('rejects invalid variants, options, quantities and unsupported shipping or payment methods', async () => {
      const bad = (fn, code) => expectOvError(fn(), code);
      await bad(() => quote(lines('00000000-0000-4000-8000-000000000000', 1)), 'variant_unavailable');
      await bad(() => quote([{ variant_id: 'not-a-uuid', quantity: 1 }]), 'invalid_lines');
      await bad(() => quote([{ variant_id: ids.zipM, quantity: -1 }]), 'invalid_lines');
      await bad(() => quote([{ variant_id: ids.zipM, quantity: 1.5 }]), 'invalid_lines');
      await bad(() => quote([]), 'invalid_lines');
      await bad(() => quote(lines(ids.zipM, 10)), 'invalid_quantity');
      await bad(() => quote(lines(ids.zipM, 1), { shipping: 'teleport' }), 'shipping_unavailable');
      await bad(() => quote(lines(ids.zipM, 1), { payment: 'bitcoin' }), 'payment_method_unavailable');
      await bad(() => quote(lines(ids.zipM, 6)), 'insufficient_stock');
    });

    it('creates one order with immutable snapshots, a stock sale movement, events and outbox rows', async () => {
      const result = await placeOrder(db.main, { lines: lines(ids.zipM, 2), expectedTotal: 8490 * 2 + 250 });
      expect(result.replayed).toBe(false);
      expect(result.order_number).toMatch(/^OV-\d{6}-[0-9A-F]{8}$/);
      expect(await stockOf(db, ids.zipM)).toEqual({ on_hand: 3, reserved: 0 });
      const items = (await db.main.query('select sku, unit_price_pkr, quantity, line_total_pkr, product_name from public.order_items where order_id = $1', [result.order_id])).rows;
      expect(items).toEqual([{ sku: 'ZIP-BLK-M', unit_price_pkr: 8490, quantity: 2, line_total_pkr: 16980, product_name: 'Zip Test Black' }]);
      const order = (await db.main.query('select * from public.orders where id = $1', [result.order_id])).rows[0];
      expect(order).toMatchObject({ subtotal_pkr: 16980, shipping_pkr: 250, total_pkr: 17230, payment_status: 'unpaid', fulfilment_status: 'unfulfilled', stock_state: 'committed', tax_status: 'not_calculated' });
      const movements = (await db.main.query("select kind, delta_on_hand from public.inventory_movements where order_id = $1", [result.order_id])).rows;
      expect(movements).toEqual([{ kind: 'sale', delta_on_hand: -2 }]);
      const outbox = (await db.main.query('select kind from public.notification_outbox order by kind')).rows.map((row) => row.kind);
      expect(outbox).toEqual(expect.arrayContaining(['order_confirmation', 'admin_new_order']));
      const tokens = (await db.main.query('select count(*)::int as n from private.order_access_tokens where order_id = $1', [result.order_id])).rows[0].n;
      expect(tokens).toBe(1);
    });

    it('ignores client-supplied prices, totals and status fields and rejects a changed total', async () => {
      const payload = { ...checkoutPayload(lines(ids.zipM, 1)), total_pkr: 1, unit_price_pkr: 1, payment_status: 'paid', user_id: ids.owner };
      payload.lines = [{ variant_id: ids.zipM, quantity: 1, unit_price_pkr: 1 }];
      const ok = await placeOrder(db.main, { payload, expectedTotal: 8740 });
      const order = (await db.main.query('select total_pkr, payment_status, user_id from public.orders where id = $1', [ok.order_id])).rows[0];
      expect(order).toEqual({ total_pkr: 8740, payment_status: 'unpaid', user_id: null });
      const error = await expectOvError(placeOrder(db.main, { lines: lines(ids.zipM, 1), expectedTotal: 8490 }), 'price_changed');
      expect(JSON.parse(error.detail).total_pkr).toBe(8740);   // the new server quote is returned for reconfirmation
    });

    it('leaves no partial order, stock change or notification when a checkout fails', async () => {
      const before = (await db.main.query('select (select count(*) from public.orders) as o, (select count(*) from public.notification_outbox) as n, (select count(*) from private.checkout_requests) as r')).rows[0];
      await expectOvError(placeOrder(db.main, { lines: [...lines(ids.zipM, 1), ...lines(ids.watchVariant, 9)], expectedTotal: 1 }), 'insufficient_stock');
      await expectOvError(placeOrder(db.main, { lines: lines(ids.zipM, 1), expectedTotal: 1 }), 'price_changed');
      const after = (await db.main.query('select (select count(*) from public.orders) as o, (select count(*) from public.notification_outbox) as n, (select count(*) from private.checkout_requests) as r')).rows[0];
      expect(after).toEqual(before);
      expect(await stockOf(db, ids.zipM)).toEqual({ on_hand: 5, reserved: 0 });
    });

    it('is idempotent: a replay returns the same order; a changed payload under the same key conflicts', async () => {
      const key = 'idem-key-0001-abcdefgh';
      const first = await placeOrder(db.main, { lines: lines(ids.zipM, 1), expectedTotal: 8740, key });
      const replay = await placeOrder(db.main, { lines: lines(ids.zipM, 1), expectedTotal: 8740, key });
      expect(replay.replayed).toBe(true);
      expect(replay.order_id).toBe(first.order_id);
      expect(await stockOf(db, ids.zipM)).toEqual({ on_hand: 4, reserved: 0 });
      await expectOvError(placeOrder(db.main, { lines: lines(ids.zipM, 2), expectedTotal: 8490 * 2 + 250, key }), 'idempotency_conflict');
      // A different checkout secret (another visitor guessing the key) gets its own namespace, not the first order.
      const other = await placeOrder(db.main, { lines: lines(ids.zipM, 1), expectedTotal: 8740, key, secret: 'some-other-visitor' });
      expect(other.order_id).not.toBe(first.order_id);
    });

    it('allocates the last item to exactly one of two simultaneous buyers', async () => {
      await db.main.query('update public.inventory set on_hand = 1 where variant_id = $1', [ids.watchVariant]);
      const a = await db.connect(); const b = await db.connect();
      const attempt = (client, n) => placeOrder(client, { lines: lines(ids.watchVariant, 1), expectedTotal: 16900 + 250, key: `race-key-${n}-abcdefghij` }).then(() => 'ok', (error) => errorCode(error));
      const results = await Promise.all([attempt(a, 1), attempt(b, 2)]);
      expect(results.sort()).toEqual(['insufficient_stock', 'ok']);
      expect(await stockOf(db, ids.watchVariant)).toEqual({ on_hand: 0, reserved: 0 });
      const sold = (await db.main.query("select count(*)::int as n from public.order_items where variant_id = $1", [ids.watchVariant])).rows[0].n;
      expect(sold).toBe(1);
    });

    it('creates one order when the same request is retried concurrently', async () => {
      const key = 'concurrent-retry-key-0001';
      const clients = await Promise.all([db.connect(), db.connect(), db.connect()]);
      const before = (await db.main.query('select count(*)::int as n from public.orders')).rows[0].n;
      const results = await Promise.all(clients.map((client) => placeOrder(client, { lines: lines(ids.zipS, 1), expectedTotal: 8740, key })));
      expect(new Set(results.map((r) => r.order_id)).size).toBe(1);
      expect(results.filter((r) => r.replayed).length).toBe(2);
      const after = (await db.main.query('select count(*)::int as n from public.orders')).rows[0].n;
      expect(after - before).toBe(1);
      expect(await stockOf(db, ids.zipS)).toEqual({ on_hand: 4, reserved: 0 });
    });

    it('validates contact and address fields without rejecting legitimate Pakistani details', async () => {
      const base = checkoutPayload(lines(ids.zipM, 1));
      const tryOrder = (mutate) => { const payload = structuredClone(base); mutate(payload); return placeOrder(db.main, { payload, expectedTotal: 8740 }); };
      await expectOvError(tryOrder((p) => { p.contact.email = 'not-an-email'; }), 'invalid_field');
      await expectOvError(tryOrder((p) => { p.contact.phone = 'abc'; }), 'invalid_field');
      await expectOvError(tryOrder((p) => { p.address.line1 = ''; }), 'invalid_field');
      await expectOvError(tryOrder((p) => { p.address.country = 'US'; }), 'invalid_field');
      await expectOvError(tryOrder((p) => { p.contact.name = 'x'.repeat(500); }), 'invalid_field');
      await tryOrder((p) => { p.contact.phone = '0300-1234567'; p.address.province = 'Sindh'; p.address.line1 = 'House 5, Street 2, Block B, Gulshan-e-Iqbal'; });
      await tryOrder((p) => { p.contact.phone = '+44 20 7946 0958'; });
    });

    it('rejects an address in a province no shipping zone covers', async () => {
      await db.main.query("update public.shipping_zones set provinces = array['Punjab'] where code = 'pakistan'");
      try {
        await expectOvError(placeOrder(db.main, { payload: checkoutPayload(lines(ids.zipM, 1), { address: { ...checkoutPayload([]).address, province: 'Sindh' } }), expectedTotal: 8740 }), 'shipping_unavailable');
      } finally {
        await db.main.query("update public.shipping_zones set provinces = null where code = 'pakistan'");
      }
    });

    it('refuses a variant whose stock is unverified, whose price is zero, or whose product is not ready', async () => {
      await db.main.query('update public.inventory set stock_verified = false where variant_id = $1', [ids.zipS]);
      await expectOvError(quote(lines(ids.zipS, 1)), 'variant_unavailable');
      await db.main.query('update public.inventory set stock_verified = true where variant_id = $1', [ids.zipS]);
      await db.main.query('update public.products set ready_to_sell = false where id = $1', [ids.zipProduct]);
      await expectOvError(quote(lines(ids.zipS, 1)), 'variant_unavailable');
      await db.main.query('update public.products set ready_to_sell = true where id = $1', [ids.zipProduct]);
    });

    it('keeps order history unchanged when the product price, name and status change later', async () => {
      const order = await placeOrder(db.main, { lines: lines(ids.zipM, 1), expectedTotal: 8740 });
      await db.main.query("update public.product_variants set price_pkr = 9999 where id = $1", [ids.zipM]);
      await db.main.query("update public.products set name = 'Renamed', status = 'archived' where id = $1", [ids.zipProduct]);
      const item = (await db.main.query('select unit_price_pkr, product_name from public.order_items where order_id = $1', [order.order_id])).rows[0];
      expect(item).toEqual({ unit_price_pkr: 8490, product_name: 'Zip Test Black' });
      await db.main.query("update public.product_variants set price_pkr = 8490 where id = $1", [ids.zipM]);
      await db.main.query("update public.products set name = 'Zip Test Black', status = 'published', ready_to_sell = true where id = $1", [ids.zipProduct]);
    });

    it('lets a guest read a minimal projection of their order only with the right capability token', async () => {
      const token = 'guest-token-plain-value';
      const order = await placeOrder(db.main, { lines: lines(ids.zipM, 1), expectedTotal: 8740, tokenHash: sha256(token) });
      const read = (number, t) => asService(db.main, (c) => c.query('select public.get_order_for_access($1, $2) as o', [number, sha256(t)]));
      const good = (await read(order.order_number, token)).rows[0].o;
      expect(good.order_number).toBe(order.order_number);
      expect(good.items).toHaveLength(1);
      expect(good.email_hint).toMatch(/^c\*\*\*@/);
      expect(Object.keys(good)).not.toEqual(expect.arrayContaining(['user_id', 'needs_attention', 'stock_state', 'is_test']));
      expect((await read(order.order_number, 'wrong-token')).rows[0].o).toBeNull();
      expect((await read('OV-000000-00000000', token)).rows[0].o).toBeNull();
      await db.main.query("update private.order_access_tokens set revoked_at = now() where order_id = $1", [order.order_id]);
      expect((await read(order.order_number, token)).rows[0].o).toBeNull();
    });

    it('exposes only booleans for availability, never exact stock', async () => {
      const rows = (await asAnon(db.main, (c) => c.query('select * from public.catalog_availability($1::uuid[])', [[ids.zipM, ids.watchVariant]]))).rows;
      expect(rows.every((row) => Object.keys(row).sort().join() === 'in_stock,low_stock,variant_id')).toBe(true);
    });
  });
});
