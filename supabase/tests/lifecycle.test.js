import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asService, asUser, createTestDatabase, errorCode, expectDenied, expectOvError } from './support/db.js';
import { checkoutPayload, openOrdering, placeOrder, seedStore, stockOf } from './support/fixtures.js';

describe('order lifecycle, stock semantics and payment events', () => {
  let db; let ids;
  beforeAll(async () => {
    db = await createTestDatabase();
    ids = await seedStore(db);
    await openOrdering(db);
    await db.main.query("insert into public.payment_methods (code, label, kind, provider, enabled) values ('testpay', 'Test online payment', 'online', 'test', true)");
  });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.main.query('update public.inventory set on_hand = 5, reserved = 0 where variant_id = any ($1)', [[ids.watchVariant, ids.zipS, ids.zipM]]);
    await db.main.query("update public.stock_reservations set status = 'released' where status = 'active'");
  });

  const owner = (fn) => asUser(db.main, ids.owner, fn);
  const rpc = async (name, args, as = owner) => (await as((c) => c.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args))).rows[0].r;
  const order = async (id) => (await db.main.query('select * from public.orders where id = $1', [id])).rows[0];
  const lines = (variantId, quantity = 1) => [{ variant_id: variantId, quantity }];
  const totalFor = (variantId, quantity) => { const sub = (variantId === ids.watchVariant ? 16900 : 8490) * quantity; return sub + (sub >= 20000 ? 0 : 250); };
  const codOrder = (variantId = ids.zipM, quantity = 1) => placeOrder(db.main, { lines: lines(variantId, quantity), expectedTotal: totalFor(variantId, quantity) });
  const onlineOrder = (variantId = ids.zipM, quantity = 1) => placeOrder(db.main, {
    payload: checkoutPayload(lines(variantId, quantity), { payment_method: 'testpay' }), expectedTotal: totalFor(variantId, quantity) });
  const payEvent = (o, over = {}) => asService(db.main, (c) => c.query('select public.apply_payment_event($1, $2, $3, $4, $5, $6, $7) as r',
    [over.provider ?? 'test', over.eventId ?? `evt-${Math.random()}`, o.order_id, over.amount ?? o.total_pkr, over.currency ?? 'PKR', over.status ?? 'succeeded', over.ref ?? null])).then((r) => r.rows[0].r.result);

  describe('cash on delivery orders', () => {
    it('follow the fulfilment transition matrix and reject skipped or backward steps', async () => {
      const o = await codOrder();
      await expectOvError(rpc('admin_set_fulfilment', [o.order_id, 'delivered', null]), 'invalid_transition');
      await expectOvError(rpc('admin_set_fulfilment', [o.order_id, 'shipped', null]), 'invalid_transition');
      await rpc('admin_set_fulfilment', [o.order_id, 'processing', null]);
      await rpc('admin_set_fulfilment', [o.order_id, 'shipped', 'Handed to courier']);
      await rpc('admin_set_fulfilment', [o.order_id, 'delivered', null]);
      await expectOvError(rpc('admin_set_fulfilment', [o.order_id, 'processing', null]), 'invalid_transition');
      await expectOvError(rpc('admin_cancel_order', [o.order_id, 'too late']), 'invalid_transition');
      const events = (await db.main.query('select kind from public.order_events where order_id = $1 order by created_at, id', [o.order_id])).rows.map((r) => r.kind);
      expect(events).toEqual(['order_placed', 'fulfilment_processing', 'fulfilment_shipped', 'fulfilment_delivered']);
    });

    it('record manual shipment details, validated, and show them as manually recorded', async () => {
      const o = await codOrder();
      await expectOvError(rpc('admin_record_shipment', [o.order_id, 'TCS', '123', 'http://insecure.example', true]), 'invalid_request');
      await rpc('admin_record_shipment', [o.order_id, 'TCS', 'TRK123', 'https://track.example/TRK123', true]);
      const row = await order(o.order_id);
      expect(row).toMatchObject({ fulfilment_status: 'shipped', tracking_carrier: 'TCS', tracking_number: 'TRK123' });
      const message = (await db.main.query("select message from public.order_events where order_id = $1 and kind = 'shipment_recorded'", [o.order_id])).rows[0].message;
      expect(message).toMatch(/Recorded manually/);
    });

    it('cancelling before shipping puts the stock back exactly once and a second cancel is refused', async () => {
      const o = await codOrder(ids.zipM, 2);
      expect(await stockOf(db, ids.zipM)).toEqual({ on_hand: 3, reserved: 0 });
      const [c1, c2] = await Promise.all([db.connect(), db.connect()]);   // concurrent calls need separate connections
      const a = asUser(c1, ids.owner, (c) => c.query('select public.admin_cancel_order($1, $2)', [o.order_id, 'customer asked']));
      const b = asUser(c2, ids.staff, (c) => c.query('select public.admin_cancel_order($1, $2)', [o.order_id, 'duplicate click']));
      const results = await Promise.allSettled([a, b]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await stockOf(db, ids.zipM)).toEqual({ on_hand: 5, reserved: 0 });
      expect((await order(o.order_id)).stock_state).toBe('restocked');
      const restocks = (await db.main.query("select count(*)::int as n from public.inventory_movements where order_id = $1 and kind = 'cancel_restock'", [o.order_id])).rows[0].n;
      expect(restocks).toBe(1);
    });

    it('can be marked paid on delivery only once and only for cash on delivery', async () => {
      const o = await codOrder();
      await rpc('admin_mark_cod_paid', [o.order_id]);
      expect((await order(o.order_id)).payment_status).toBe('paid');
      await expectOvError(rpc('admin_mark_cod_paid', [o.order_id]), 'invalid_transition');
    });

    it('record returns, restock only after receipt and only once, and treat a refund as real only when confirmed', async () => {
      const o = await codOrder(ids.zipM, 2);
      await rpc('admin_mark_cod_paid', [o.order_id]);
      await rpc('admin_set_fulfilment', [o.order_id, 'processing', null]);
      await rpc('admin_set_fulfilment', [o.order_id, 'shipped', null]);
      await rpc('admin_set_fulfilment', [o.order_id, 'delivered', null]);
      const item = (await db.main.query('select id from public.order_items where order_id = $1', [o.order_id])).rows[0].id;
      await expectOvError(rpc('admin_create_return', [o.order_id, 'wrong size', JSON.stringify([{ order_item_id: item, quantity: 3 }])]), 'invalid_quantity');
      const returnId = await rpc('admin_create_return', [o.order_id, 'wrong size', JSON.stringify([{ order_item_id: item, quantity: 1 }])]);
      const returnItem = (await db.main.query('select id from public.order_return_items where return_id = $1', [returnId])).rows[0].id;
      await expectOvError(rpc('admin_restock_return_item', [returnItem]), 'invalid_transition');   // not received yet
      await rpc('admin_set_return_status', [returnId, 'approved', null]);
      await rpc('admin_set_return_status', [returnId, 'received', 'arrived']);
      const before = await stockOf(db, ids.zipM);
      await rpc('admin_restock_return_item', [returnItem]);
      expect((await stockOf(db, ids.zipM)).on_hand).toBe(before.on_hand + 1);
      await expectOvError(rpc('admin_restock_return_item', [returnItem]), 'invalid_transition');   // at most once
      // Refund: recording the request does not change the payment state; confirmation does.
      const refundId = await rpc('admin_request_refund', [o.order_id, 8490, 'wrong size', returnId]);
      expect((await order(o.order_id)).payment_status).toBe('paid');
      await expectOvError(rpc('admin_request_refund', [o.order_id, 99999, 'too much', null]), 'refund_exceeds_total');
      await rpc('admin_confirm_refund', [refundId, 'bank transfer ref 42']);
      expect((await order(o.order_id)).payment_status).toBe('partially_refunded');
      await expectOvError(rpc('admin_confirm_refund', [refundId, 'again']), 'invalid_transition');
    });
  });

  describe('online payment orders', () => {
    it('reserve stock without selling it, and commit it on a verified payment event', async () => {
      const o = await onlineOrder(ids.zipM, 2);
      expect(await stockOf(db, ids.zipM)).toEqual({ on_hand: 5, reserved: 2 });
      expect(await order(o.order_id)).toMatchObject({ payment_status: 'pending', stock_state: 'reserved' });
      expect(await payEvent(o, { eventId: 'evt-ok-1' })).toBe('processed');
      expect(await stockOf(db, ids.zipM)).toEqual({ on_hand: 3, reserved: 0 });
      expect(await order(o.order_id)).toMatchObject({ payment_status: 'paid', stock_state: 'committed' });
    });

    it('dedupe replayed provider events and ignore reordered or contradictory ones', async () => {
      const o = await onlineOrder();
      expect(await payEvent(o, { eventId: 'evt-dup' })).toBe('processed');
      expect(await payEvent(o, { eventId: 'evt-dup' })).toBe('duplicate');
      expect(await payEvent(o, { eventId: 'evt-fail-after-paid', status: 'failed' })).toBe('ignored');
      expect((await order(o.order_id)).payment_status).toBe('paid');
      expect(await stockOf(db, ids.zipM)).toEqual({ on_hand: 4, reserved: 0 });
    });

    it('reject events whose amount or currency does not match the order and flag it for an admin', async () => {
      const o = await onlineOrder();
      expect(await payEvent(o, { eventId: 'evt-low', amount: 1 })).toBe('rejected');
      expect(await payEvent(o, { eventId: 'evt-usd', currency: 'USD' })).toBe('rejected');
      expect(await order(o.order_id)).toMatchObject({ payment_status: 'pending', needs_attention: true, attention_reason: 'payment_amount_mismatch' });
      expect(await stockOf(db, ids.zipM)).toEqual({ on_hand: 5, reserved: 1 });
    });

    it('release the reservation once when the payment fails', async () => {
      const o = await onlineOrder();
      expect(await payEvent(o, { eventId: 'evt-f1', status: 'failed' })).toBe('processed');
      expect(await payEvent(o, { eventId: 'evt-f2', status: 'failed' })).toBe('ignored');
      expect(await stockOf(db, ids.zipM)).toEqual({ on_hand: 5, reserved: 0 });
      expect(await order(o.order_id)).toMatchObject({ payment_status: 'failed', fulfilment_status: 'cancelled', stock_state: 'released' });
    });

    it('expire after the window: maintenance releases stock, and a late payment is flagged instead of overselling', async () => {
      const o = await onlineOrder(ids.watchVariant, 5);
      expect((await stockOf(db, ids.watchVariant)).reserved).toBe(5);
      await db.main.query("update public.stock_reservations set expires_at = now() - interval '1 minute' where order_id = $1", [o.order_id]);
      const result = await asService(db.main, (c) => c.query('select public.run_maintenance() as r'));
      expect(result.rows[0].r.expired_orders).toBe(1);
      expect(await stockOf(db, ids.watchVariant)).toEqual({ on_hand: 5, reserved: 0 });
      expect(await order(o.order_id)).toMatchObject({ payment_status: 'failed', fulfilment_status: 'cancelled', stock_state: 'released' });
      // Someone else buys the stock that was freed.
      await codOrder(ids.watchVariant, 5).catch(() => null);
      const late = await payEvent(o, { eventId: 'evt-late' });
      expect(late).toBe('needs_reconciliation');
      expect(await order(o.order_id)).toMatchObject({ needs_attention: true, attention_reason: 'payment_after_release', payment_status: 'paid' });
      const stock = await stockOf(db, ids.watchVariant);
      expect(stock.on_hand).toBeGreaterThanOrEqual(0);           // never negative, never silently committed
    });

    it('free expired stock lazily at checkout even when no scheduler ran', async () => {
      const o = await onlineOrder(ids.zipS, 5);
      await expectOvError(codOrder(ids.zipS, 1), 'insufficient_stock');
      await db.main.query("update public.stock_reservations set expires_at = now() - interval '1 minute' where order_id = $1", [o.order_id]);
      const next = await codOrder(ids.zipS, 1);
      expect(next.replayed).toBe(false);
      expect(await order(o.order_id)).toMatchObject({ stock_state: 'released', fulfilment_status: 'cancelled' });
    });

    it('settle a cancel racing a payment event without releasing or committing twice', async () => {
      const o = await onlineOrder(ids.zipM, 2);
      const [c1, c2] = await Promise.all([db.connect(), db.connect()]);
      const cancel = asUser(c1, ids.owner, (c) => c.query('select public.admin_cancel_order($1, $2)', [o.order_id, 'customer changed mind'])).then(() => 'cancelled', (e) => errorCode(e));
      const pay = asService(c2, (c) => c.query('select public.apply_payment_event($1, $2, $3, $4, $5, $6, $7) as r', ['test', 'evt-race', o.order_id, o.total_pkr, 'PKR', 'succeeded', null])).then((r) => r.rows[0].r.result, (e) => errorCode(e));
      await Promise.all([cancel, pay]);
      const stock = await stockOf(db, ids.zipM);
      const row = await order(o.order_id);
      expect(stock.reserved).toBe(0);
      // Either the payment won (stock sold, then cancel restocked once) or the cancel won (released, late payment flagged).
      expect([5, 3]).toContain(stock.on_hand);
      const moves = (await db.main.query("select kind, sum(delta_on_hand)::int as d, sum(delta_reserved)::int as r from public.inventory_movements where order_id = $1 group by kind", [o.order_id])).rows;
      const net = moves.reduce((acc, m) => ({ onHand: acc.onHand + m.d, reserved: acc.reserved + m.r }), { onHand: 0, reserved: 0 });
      expect(net.reserved).toBe(0);
      expect(5 + net.onHand).toBe(stock.on_hand);
      expect(['cancelled']).toContain(row.fulfilment_status);
    });

    it('cannot be fulfilled while payment is still pending', async () => {
      const o = await onlineOrder();
      await expectOvError(rpc('admin_set_fulfilment', [o.order_id, 'processing', null]), 'payment_not_settled');
    });
  });

  describe('inventory administration', () => {
    it('requires a reason, is idempotent by operation key, and cannot go below reserved stock', async () => {
      await expectOvError(rpc('admin_adjust_inventory', [ids.zipS, 'set', 8, '', null, true]), 'invalid_request');
      const first = await rpc('admin_adjust_inventory', [ids.zipS, 'set', 8, 'stock count', 'op-1', true]);
      expect(first).toMatchObject({ replayed: false, on_hand: 8 });
      const replay = await rpc('admin_adjust_inventory', [ids.zipS, 'delta', 100, 'would double', 'op-1', true]);
      expect(replay.replayed).toBe(true);
      expect((await stockOf(db, ids.zipS)).on_hand).toBe(8);
      await onlineOrder(ids.zipS, 3);
      await expectOvError(rpc('admin_adjust_inventory', [ids.zipS, 'set', 1, 'recount', null, true]), 'below_reserved');
      await expectOvError(rpc('admin_adjust_inventory', [ids.zipS, 'delta', -9999, 'oops', null, true]), 'invalid_quantity');
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query("select public.admin_adjust_inventory($1, 'set', 5, 'hack', null, true)", [ids.zipS])));
    });

    it('keeps movement history immutable', async () => {
      await expect(db.main.query("update public.inventory_movements set delta_on_hand = 0")).rejects.toThrow(/append_only/);
      await expect(db.main.query('delete from public.inventory_movements')).rejects.toThrow(/append_only/);
      await expect(db.main.query("update public.order_events set message = 'x'")).rejects.toThrow(/append_only/);
      await expect(db.main.query('delete from public.admin_audit_log')).rejects.toThrow(/append_only/);
    });

    it('treats a variant with unverified stock as not purchasable until an admin confirms the count', async () => {
      const fresh = (await db.main.query("insert into public.product_variants (product_id, sku, size_label, price_pkr) values ($1, 'ZIP-BLK-XL', 'XL', 8490) returning id", [ids.zipProduct])).rows[0].id;
      await expectOvError(placeOrder(db.main, { lines: lines(fresh, 1), expectedTotal: 8740 }), 'variant_unavailable');
      await rpc('admin_adjust_inventory', [fresh, 'set', 3, 'first count', null, true]);
      expect((await placeOrder(db.main, { lines: lines(fresh, 1), expectedTotal: 8740 })).replayed).toBe(false);
    });
  });

  describe('publication, images and the ordering switch', () => {
    it('refuses to mark a product ready to sell without verified stock, a price and an approved cover image', async () => {
      const p = (await db.main.query("insert into public.products (slug, name, category_id, kind) values ('readiness-test', 'Readiness Test', $1, 'watch') returning id", [ids.catWatches])).rows[0].id;
      await expect(db.main.query("update public.products set status = 'published' where id = $1", [p])).rejects.toThrow(/not_publishable/);
      const v = (await db.main.query("insert into public.product_variants (product_id, sku, price_pkr) values ($1, 'READY-1', 0) returning id", [p])).rows[0].id;
      await db.main.query("update public.products set status = 'published' where id = $1", [p]);
      await expect(db.main.query('update public.products set ready_to_sell = true where id = $1', [p])).rejects.toThrow(/not_ready_to_sell/);
      const problems = (await rpc('product_readiness', [p])).sort();
      expect(problems).toEqual(['no_approved_cover_image', 'price_missing', 'stock_not_verified']);
      await db.main.query('update public.product_variants set price_pkr = 5000 where id = $1', [v]);
      await rpc('admin_adjust_inventory', [v, 'set', 2, 'count', null, true]);
      const noCover = await db.main.query('update public.products set ready_to_sell = true where id = $1', [p]).catch((e) => e);
      expect(noCover.message).toMatch(/not_ready_to_sell/);
      expect(JSON.parse(noCover.detail)).toContain('no_approved_cover_image');
      await db.main.query("insert into public.product_images (product_id, bucket, path, is_cover, source_name) values ($1, 'product-private', 'drafts/readiness.webp', true, 'Test')", [p]);
      const imageId = (await db.main.query("select id from public.product_images where product_id = $1", [p])).rows[0].id;
      await expectOvError(rpc('admin_approve_image', [imageId, 'products/readiness-test/v1/cover.webp']), 'provenance_required');
      await db.main.query("insert into storage.objects (bucket_id, name) values ('product-public', 'products/readiness-test/v1/cover.webp')");
      await db.main.query("update public.product_images set licence = 'Test licence' where id = $1", [imageId]);
      await rpc('admin_approve_image', [imageId, 'products/readiness-test/v1/cover.webp']);
      await db.main.query('update public.products set ready_to_sell = true where id = $1', [p]);
      expect((await db.main.query('select ready_to_sell from public.products where id = $1', [p])).rows[0].ready_to_sell).toBe(true);
    });

    it('never lets an unapproved image sit in the public bucket', async () => {
      await expect(db.main.query("insert into public.product_images (product_id, bucket, path, approval_status) values ($1, 'product-public', 'x/y.webp', 'unverified')", [ids.zipProduct])).rejects.toThrow(/check/i);
    });

    it('only the owner can open ordering, and only when the store is ready', async () => {
      await db.main.query('begin');
      await db.main.query("select set_config('oldverge.ordering_toggle', 'on', true)");
      await db.main.query("update public.store_settings set value = 'false'::jsonb where key = 'ordering_enabled'");
      await db.main.query('commit');
      await expectDenied(asUser(db.main, ids.staff, (c) => c.query('select public.admin_set_ordering_enabled(true)')));
      await db.main.query("update public.payment_methods set enabled = false");
      const blocked = await expectOvError(rpc('admin_set_ordering_enabled', [true]), 'not_ready_for_ordering');
      expect(JSON.parse(blocked.detail)).toContain('no_enabled_payment_method');
      await db.main.query("update public.payment_methods set enabled = true where code in ('cod', 'testpay')");
      await db.main.query("update public.store_settings set value = 'null'::jsonb where key = 'contact.email'");
      expect(JSON.parse((await expectOvError(rpc('admin_set_ordering_enabled', [true]), 'not_ready_for_ordering')).detail)).toContain('no_contact_channel');
      await db.main.query("update public.store_settings set value = to_jsonb('hello@example.test'::text) where key = 'contact.email'");
      expect(await rpc('admin_set_ordering_enabled', [true])).toEqual({ ordering_enabled: true });
    });
  });

  describe('operations: search, dashboard, export, outbox, rate limit and support', () => {
    it('lists orders with search, filters and pagination, only for admins', async () => {
      await codOrder(); await codOrder(); await codOrder();
      const page = await rpc('admin_list_orders', ['customer@example.test', null, null, null, true, 2, 0]);
      expect(page.rows).toHaveLength(2);
      expect(page.total).toBeGreaterThanOrEqual(3);
      const next = await rpc('admin_list_orders', ['customer@example.test', null, null, null, true, 2, 2]);
      expect(next.rows.length).toBeGreaterThanOrEqual(1);
      const none = await rpc('admin_list_orders', ["%' or 1=1 --", null, null, null, true, 25, 0]);
      expect(none.total).toBe(0);
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query('select public.admin_list_orders()')));
    });

    it('excludes test, cancelled and unpaid orders from revenue and records exports in the audit log', async () => {
      await db.main.query('delete from public.refunds');
      const paid = await codOrder(); await rpc('admin_mark_cod_paid', [paid.order_id]);
      const unpaid = await codOrder();
      const test = await placeOrder(db.main, { lines: lines(ids.zipM, 1), expectedTotal: 8740, isTest: true });
      await rpc('admin_mark_cod_paid', [test.order_id]);
      const stats = await rpc('admin_dashboard_stats', [new Date(Date.now() - 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString()]);
      const expected = (await db.main.query("select coalesce(sum(total_pkr), 0)::int as s from public.orders where payment_status in ('paid', 'partially_refunded') and fulfilment_status <> 'cancelled' and not is_test")).rows[0].s
        - (await db.main.query("select coalesce(sum(r.amount_pkr), 0)::int as s from public.refunds r join public.orders o on o.id = r.order_id where r.status = 'confirmed' and not o.is_test and o.fulfilment_status <> 'cancelled'")).rows[0].s;
      expect(stats.revenue_pkr).toBe(expected);
      expect(stats.awaiting_cod_pkr).toBeGreaterThanOrEqual(8740);
      expect(unpaid.order_id).toBeTruthy();
      const rows = (await owner((c) => c.query('select * from public.admin_export_orders($1, $2, 5)', [null, null]))).rows;
      expect(rows.length).toBeLessThanOrEqual(5);
      const logged = (await db.main.query("select count(*)::int as n from public.admin_audit_log where action = 'export'")).rows[0].n;
      expect(logged).toBeGreaterThanOrEqual(1);
    });

    it('claims outbox rows once, retries with back-off and never sends twice', async () => {
      await codOrder();
      const claimed = (await asService(db.main, (c) => c.query('select * from public.claim_outbox(50)'))).rows;
      expect(claimed.length).toBeGreaterThan(0);
      expect(claimed.every((row) => row.attempts === 1)).toBe(true);
      const again = (await asService(db.main, (c) => c.query('select * from public.claim_outbox(50)'))).rows;
      expect(again).toEqual([]);                                  // backed off: not claimable again straight away
      await asService(db.main, (c) => c.query("select public.finish_outbox($1, 'sent', null)", [claimed[0].id]));
      await asService(db.main, (c) => c.query("select public.finish_outbox($1, 'failed', 'provider not configured')", [claimed[1]?.id ?? claimed[0].id]));
      const statuses = (await db.main.query('select status from public.notification_outbox where id = any ($1)', [claimed.slice(0, 2).map((r) => r.id)])).rows.map((r) => r.status);
      expect(statuses).toContain('sent');
      const dup = (await db.main.query("select count(*)::int as n from (select dedupe_key from public.notification_outbox group by 1 having count(*) > 1) d")).rows[0].n;
      expect(dup).toBe(0);
    });

    it('rate limits per key and window', async () => {
      const hit = () => asService(db.main, (c) => c.query("select public.hit_rate_limit('ip:1.2.3.4:create-order', 3, 60) as ok")).then((r) => r.rows[0].ok);
      expect([await hit(), await hit(), await hit(), await hit()]).toEqual([true, true, true, false]);
    });

    it('stores contact messages privately with validation, and dedupes newsletter sign-ups without disclosure', async () => {
      const submit = (payload) => asService(db.main, (c) => c.query('select public.submit_contact($1::jsonb) as id', [JSON.stringify(payload)]));
      await submit({ first_name: 'Ayesha', email: 'ayesha@example.test', message: 'Hello there', topics: ['sizing'] });
      await expect(submit({ first_name: '', email: 'bad', message: '' })).rejects.toThrow(/invalid_field/);
      const msg = (await db.main.query("select status, kind from public.contact_messages where email = 'ayesha@example.test'")).rows;
      expect(msg).toEqual([{ status: 'new', kind: 'contact' }]);
      const sub = (email, hash) => asService(db.main, (c) => c.query("select public.newsletter_subscribe($1, 'I agree to receive news', 'footer', $2)", [email, hash]));
      const { sha256 } = await import('./support/db.js');
      await sub('Reader@Example.test', sha256('one'));
      await sub('reader@example.test', sha256('two'));            // same address: silent no-op
      expect((await db.main.query("select count(*)::int as n from public.newsletter_subscriptions where lower(email) = 'reader@example.test'")).rows[0].n).toBe(1);
      expect((await asService(db.main, (c) => c.query('select public.newsletter_unsubscribe($1) as ok', [sha256('two')]))).rows[0].ok).toBe(false);
      expect((await asService(db.main, (c) => c.query('select public.newsletter_unsubscribe($1) as ok', [sha256('one')]))).rows[0].ok).toBe(true);
    });

    it('searches published products with escaped wildcards and bounded results', async () => {
      const search = async (q) => (await db.main.query('select slug from public.search_catalog($1, 50)', [q])).rows.map((r) => r.slug);
      expect(await search('casio')).toContain('casio-test');
      expect(await search('black')).toContain('zip-test-black');
      expect(await search('%')).toEqual([]);
      expect(await search('_')).toEqual([]);
      expect(await search('')).toEqual([]);
      expect(await search('x'.repeat(200))).toEqual([]);
    });
  });
});
