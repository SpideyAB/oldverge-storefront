import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, newUuid } from './support/db.js';
import { checkoutPayload, openOrdering, seedStore } from './support/fixtures.js';
import { freshKey, freshSecret, jsonRequest, makeDeps, tokenFor } from './support/function-deps.js';
import {
  createOrder, maintenance, newsletterSubscribe, newsletterUnsubscribe, orderStatus, paymentWebhook, processOutbox, quoteOrder, submitContact,
} from '../functions/_shared/handlers.js';
import { newsletterToken } from '../functions/_shared/crypto.js';

const URL_BASE = 'https://project.functions.test/functions/v1/';

describe('Edge Function handlers against the real database', () => {
  let db; let ids; let deps;
  beforeAll(async () => {
    db = await createTestDatabase();
    ids = await seedStore(db);
    await openOrdering(db);
    deps = makeDeps(db);
  });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.main.query('update public.inventory set on_hand = 50, reserved = 0');
    // Every test reuses one customer email; reset only the per-contact order limit between tests.
    await db.main.query("delete from private.rate_limits where bucket_key like 'create-order-contact:%'");
  });

  const call = async (handler, body, options) => {
    const response = await handler(jsonRequest(`${URL_BASE}x`, body, options));
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };
  const orderBody = (variantId, quantity, over = {}) => {
    const payload = checkoutPayload([{ variant_id: variantId, quantity }]);
    const sub = 8490 * quantity;
    return {
      idempotency_key: freshKey(), checkout_secret: freshSecret(), lines: payload.lines, shipping_method: 'standard', payment_method: 'cod',
      contact: payload.contact, address: payload.address, expected_total_pkr: sub + (sub >= 20000 ? 0 : 250), ...over,
    };
  };

  describe('quote-order and create-order', () => {
    it('quotes server-side totals for guests', async () => {
      const handler = quoteOrder(deps);
      const res = await call(handler, { lines: [{ variant_id: ids.zipM, quantity: 2 }], shipping_method: 'standard', province: 'Punjab', payment_method: 'cod' });
      expect(res.status).toBe(200);
      expect(res.body.quote.total_pkr).toBe(8490 * 2 + 250);
    });

    it('creates an order for a guest, returns a capability, and never returns internal fields', async () => {
      const res = await call(createOrder(deps), orderBody(ids.zipM, 1));
      expect(res.status).toBe(201);
      expect(res.body.order_number).toMatch(/^OV-\d{6}-[0-9A-F]{8}$/);
      expect(res.body.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.body).not.toHaveProperty('order_id');
      expect(res.headers.get('access-control-allow-origin')).toBe('https://oldverge-storefront.vercel.app');
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('lets the guest read the order back only with the capability, and hides everything otherwise', async () => {
      const created = await call(createOrder(deps), orderBody(ids.zipM, 1));
      const status = orderStatus(deps);
      const ok = await call(status, { order_number: created.body.order_number, access_token: created.body.access_token });
      expect(ok.status).toBe(200);
      expect(ok.body.order.items[0].sku).toBe('ZIP-BLK-M');
      expect(ok.body.order).not.toHaveProperty('user_id');
      const bad = await call(status, { order_number: created.body.order_number, access_token: 'A'.repeat(43) });
      const unknown = await call(status, { order_number: 'OV-000000-00000000', access_token: created.body.access_token });
      const malformed = await call(status, { order_number: 'nope', access_token: 'short' });
      expect([bad.status, unknown.status, malformed.status]).toEqual([404, 404, 404]);
      expect(bad.body).toEqual(unknown.body);                                  // no way to tell which part was wrong
      const onlyNumber = await call(status, { order_number: created.body.order_number });
      expect(onlyNumber.status).toBe(404);                                     // an order number alone unlocks nothing
    });

    it('replays a retried checkout (same key and secret) with the same order and the same capability', async () => {
      const body = orderBody(ids.zipM, 1);
      const first = await call(createOrder(deps), body);
      const retry = await call(createOrder(deps), body);
      expect(retry.status).toBe(200);
      expect(retry.body.replayed).toBe(true);
      expect(retry.body.order_number).toBe(first.body.order_number);
      expect(retry.body.access_token).toBe(first.body.access_token);
      const changed = await call(createOrder(deps), { ...body, lines: [{ variant_id: ids.zipM, quantity: 2 }], expected_total_pkr: 8490 * 2 + 250 });
      expect(changed.status).toBe(409);
      expect(changed.body.error).toBe('idempotency_conflict');
    });

    it('does not let someone else replay or read a checkout by guessing the key', async () => {
      const body = orderBody(ids.zipM, 1);
      const first = await call(createOrder(deps), body);
      const thief = await call(createOrder(deps), { ...body, checkout_secret: freshSecret() });
      expect(thief.body.order_number).not.toBe(first.body.order_number);
      expect(thief.body.access_token).not.toBe(first.body.access_token);
    });

    it('rejects tampering: wrong total, unknown fields, bad variants, bad quantities and unsupported methods', async () => {
      const handler = createOrder(deps);
      const wrong = await call(handler, orderBody(ids.zipM, 1, { expected_total_pkr: 1 }));
      expect(wrong.status).toBe(409);
      expect(wrong.body).toMatchObject({ error: 'price_changed', details: { total_pkr: 8740 } });
      expect((await call(handler, orderBody(ids.zipM, 1, { total_pkr: 1 }))).status).toBe(400);
      expect((await call(handler, orderBody(ids.zipM, 1, { payment_status: 'paid' }))).status).toBe(400);
      expect((await call(handler, { ...orderBody(ids.zipM, 1), lines: [{ variant_id: ids.zipM, quantity: 1, unit_price_pkr: 1 }] })).status).toBe(400);
      expect((await call(handler, orderBody(newUuid(), 1))).body.error).toBe('variant_unavailable');
      expect((await call(handler, orderBody(ids.zipM, 0))).status).toBe(400);
      expect((await call(handler, orderBody(ids.zipM, -3))).status).toBe(400);
      expect((await call(handler, orderBody(ids.zipM, 1, { shipping_method: 'teleport' }))).body.error).toBe('shipping_unavailable');
      expect((await call(handler, orderBody(ids.zipM, 1, { payment_method: 'bitcoin' }))).body.error).toBe('payment_method_unavailable');
      expect((await call(handler, orderBody(ids.zipM, 1, { checkout_secret: 'short' }))).status).toBe(400);
      expect((await call(handler, orderBody(ids.zipM, 1, { idempotency_key: 'bad key!' }))).status).toBe(400);
    });

    it('enforces size, content type and method limits', async () => {
      const handler = createOrder(deps);
      const huge = await handler(new Request(`${URL_BASE}x`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.1' }, body: JSON.stringify({ pad: 'x'.repeat(70000) }) }));
      expect(huge.status).toBe(413);
      const wrongType = await handler(new Request(`${URL_BASE}x`, { method: 'POST', headers: { 'content-type': 'text/plain', 'x-forwarded-for': '10.9.9.2' }, body: 'hello' }));
      expect(wrongType.status).toBe(415);
      const get = await handler(new Request(`${URL_BASE}x`, { method: 'GET', headers: { 'x-forwarded-for': '10.9.9.3' } }));
      expect(get.status).toBe(405);
      const garbage = await handler(new Request(`${URL_BASE}x`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.4' }, body: '{nope' }));
      expect(garbage.status).toBe(400);
    });

    it('answers CORS preflight only for configured storefront origins', async () => {
      const handler = createOrder(deps);
      const allowed = await handler(new Request(`${URL_BASE}x`, { method: 'OPTIONS', headers: { origin: 'https://oldverge-storefront.vercel.app' } }));
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://oldverge-storefront.vercel.app');
      const blocked = await handler(new Request(`${URL_BASE}x`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
      expect(blocked.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('persistently rate limits a noisy client and fails closed', async () => {
      const handler = createOrder(deps);
      const statuses = [];
      for (let i = 0; i < 12; i += 1) {
        await db.main.query("delete from private.rate_limits where bucket_key like 'create-order-contact:%'");   // isolate the per-IP limit
        statuses.push((await call(handler, orderBody(ids.zipM, 1, { expected_total_pkr: 1 }), { headers: { 'x-forwarded-for': '203.0.113.50' } })).status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
      const broken = { ...deps, admin: { ...deps.admin, rpc: async () => ({ data: null, error: { message: 'db down' } }) } };
      expect((await call(createOrder(broken), orderBody(ids.zipM, 1), { headers: { 'x-forwarded-for': '198.51.100.9' } })).status).toBe(429);
    });

    it('cannot be bypassed by a spoofed X-Forwarded-For, and limits orders per contact', async () => {
      const handler = createOrder(deps);
      const spoofed = [];
      for (let i = 0; i < 12; i += 1) {
        await db.main.query("delete from private.rate_limits where bucket_key like 'create-order-contact:%'");
        spoofed.push((await call(handler, orderBody(ids.zipM, 1, { expected_total_pkr: 1 }), { headers: { 'cf-connecting-ip': '192.0.2.77', 'x-forwarded-for': `10.0.0.${i}` } })).status);
      }
      expect(spoofed.slice(10)).toEqual([429, 429]);
      const perContact = [];
      for (let i = 0; i < 9; i += 1) {
        perContact.push((await call(handler, orderBody(ids.zipM, 1, { expected_total_pkr: 1 }), { headers: { 'cf-connecting-ip': `192.0.2.${100 + i}` } })).status);
      }
      expect(perContact.slice(0, 8).every((s) => s === 409)).toBe(true);
      expect(perContact[8]).toBe(429);
    });

    it('binds a signed-in customer to the order and rejects an invalid session instead of treating it as a guest', async () => {
      const handler = createOrder(deps);
      const headers = { authorization: `Bearer ${tokenFor(ids.customerA)}` };
      const mine = await call(handler, { ...orderBody(ids.zipM, 1), checkout_secret: undefined }, { headers });
      expect(mine.status).toBe(201);
      const owner = (await db.main.query('select user_id from public.orders where order_number = $1', [mine.body.order_number])).rows[0].user_id;
      expect(owner).toBe(ids.customerA);
      const expired = await call(handler, orderBody(ids.zipM, 1), { headers: { authorization: 'Bearer invalid.token.value-that-is-long-enough' } });
      expect(expired.status).toBe(401);
    });

    it('is closed with a clear error while ordering is disabled, and reports missing configuration honestly', async () => {
      const unconfigured = makeDeps(db, { env: { TOKEN_SECRET: '' } });
      const res = await call(createOrder(unconfigured), orderBody(ids.zipM, 1));
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('not_configured');
      await db.main.query('begin');
      await db.main.query("select set_config('oldverge.ordering_toggle', 'on', true)");
      await db.main.query("update public.store_settings set value = 'false'::jsonb where key = 'ordering_enabled'");
      await db.main.query('commit');
      try {
        const closed = await call(createOrder(deps), orderBody(ids.zipM, 1));
        expect(closed.status).toBe(403);
        expect(closed.body.error).toBe('ordering_closed');
      } finally {
        await openOrdering(db);
      }
    });

    it('marks orders as test orders in preview mode so they never count as revenue', async () => {
      const preview = makeDeps(db, { env: { ORDER_TEST_MODE: 'true' } });
      const res = await call(createOrder(preview), orderBody(ids.zipM, 1));
      const row = (await db.main.query('select is_test from public.orders where order_number = $1', [res.body.order_number])).rows[0];
      expect(row.is_test).toBe(true);
    });
  });

  describe('contact and newsletter', () => {
    const contact = (over = {}) => ({ first_name: 'Sana', last_name: 'Khan', email: 'sana@example.test', phone: '0300 1234567', topics: ['orders'], message: 'Do you have size L?', ...over });

    it('stores a validated message privately and confirms only that it was saved', async () => {
      const res = await call(submitContact(deps), contact());
      expect(res).toMatchObject({ status: 201, body: { saved: true } });
      expect((await db.main.query("select count(*)::int as n from public.contact_messages where email = 'sana@example.test'")).rows[0].n).toBe(1);
    });

    it('rejects invalid input and silently drops honeypot submissions without storing them', async () => {
      expect((await call(submitContact(deps), contact({ email: 'nope' }))).status).toBe(400);
      expect((await call(submitContact(deps), contact({ message: '' }))).status).toBe(400);
      expect((await call(submitContact(deps), contact({ unexpected: 'x' }))).status).toBe(400);
      const before = (await db.main.query('select count(*)::int as n from public.contact_messages')).rows[0].n;
      const bot = await call(submitContact(deps), contact({ website: 'http://spam.example' }));
      expect(bot.status).toBe(200);
      expect((await db.main.query('select count(*)::int as n from public.contact_messages')).rows[0].n).toBe(before);
    });

    it('rate limits contact submissions per client', async () => {
      const statuses = [];
      for (let i = 0; i < 7; i += 1) statuses.push((await call(submitContact(deps), contact({ first_name: `N${i}` }), { headers: { 'x-forwarded-for': '203.0.113.77' } })).status);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2);
    });

    it('requires explicit newsletter consent, gives the same answer for duplicates and supports unsubscribe', async () => {
      const subscribe = newsletterSubscribe(deps);
      const body = { email: 'reader2@example.test', consent: true, consent_text: 'I agree to receive OLDVERGE news' };
      expect((await call(subscribe, { ...body, consent: false })).status).toBe(400);
      expect((await call(subscribe, { ...body, consent: undefined })).status).toBe(400);
      const first = await call(subscribe, body);
      const again = await call(subscribe, body);
      expect([first.status, again.status]).toEqual([201, 201]);
      expect(first.body).toEqual(again.body);
      const token = await newsletterToken(deps.env.get('TOKEN_SECRET'), 'reader2@example.test');
      expect((await call(newsletterUnsubscribe(deps), { token: 'x'.repeat(43) })).body.unsubscribed).toBe(false);
      expect((await call(newsletterUnsubscribe(deps), { token })).body.unsubscribed).toBe(true);
    });
  });

  describe('scheduled, provider and admin-only endpoints', () => {
    const post = (handler, headers = {}) => handler(new Request(`${URL_BASE}x`, { method: 'POST', headers: { 'x-forwarded-for': `10.1.1.${Math.floor(Math.random() * 250)}`, ...headers } })).then(async (r) => ({ status: r.status, body: await r.json() }));

    it('runs maintenance only for the scheduler secret or an admin', async () => {
      expect((await post(maintenance(deps))).status).toBe(401);
      expect((await post(maintenance(deps), { 'x-cron-secret': 'wrong-secret-wrong-secret-wrong' })).status).toBe(401);
      expect((await post(maintenance(deps), { authorization: `Bearer ${tokenFor(ids.customerA)}` })).status).toBe(403);
      const cron = await post(maintenance(deps), { 'x-cron-secret': deps.env.get('CRON_SECRET') });
      expect(cron.status).toBe(200);
      expect(cron.body.result).toHaveProperty('expired_orders');
      expect((await post(maintenance(deps), { authorization: `Bearer ${tokenFor(ids.owner)}` })).status).toBe(200);
    });

    it('does not touch the outbox when no email provider is configured, and sends/records when one is', async () => {
      const pending = (await db.main.query("select count(*)::int as n from public.notification_outbox where status = 'pending'")).rows[0].n;
      expect(pending).toBeGreaterThan(0);
      const none = await post(processOutbox(deps), { 'x-cron-secret': deps.env.get('CRON_SECRET') });
      expect(none.body).toEqual({ provider: 'not_configured', sent: 0, failed: 0 });
      expect((await db.main.query("select count(*)::int as n from public.notification_outbox where status = 'pending'")).rows[0].n).toBe(pending);
      const sentKinds = [];
      const withMailer = makeDeps(db, { mailer: { async send(kind) { if (kind === 'admin_new_order') throw new Error('provider rejected'); sentKinds.push(kind); } } });
      const res = await post(processOutbox(withMailer), { 'x-cron-secret': withMailer.env.get('CRON_SECRET') });
      expect(res.body.provider).toBe('configured');
      expect(res.body.sent + res.body.failed).toBeGreaterThan(0);
      const failed = (await db.main.query("select status, last_error from public.notification_outbox where status = 'failed' limit 1")).rows[0];
      if (res.body.failed > 0) expect(failed.last_error).toMatch(/provider rejected/);
    });

    it('refuses payment webhooks until a provider is configured', async () => {
      const res = await post(paymentWebhook(deps));
      expect(res.status).toBe(501);
      expect(res.body.error).toBe('payment_provider_not_configured');
    });
  });
});
