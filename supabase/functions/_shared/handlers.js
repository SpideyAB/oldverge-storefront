// Endpoint implementations. Each factory takes `deps` (see endpoint.js) and returns a (Request) => Response.
// Business rules live in the database (SQL functions); these endpoints validate input, rate-limit,
// authenticate, call exactly one narrowly granted RPC and translate the result.

import { endpoint, HttpError, hit, requireAdmin, rpc } from './endpoint.js';
import { bearerToken, clientIp } from './http.js';
import { newsletterToken, orderAccessToken, safeEqual, sha256, toBytea, toHex } from './crypto.js';
import * as v from './validate.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,100}$/;
const ACCESS_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ORDER_NUMBER = /^OV-\d{6}-[0-9A-F]{8}$/;

const tokenSecret = (deps) => {
  const secret = deps.env.get('TOKEN_SECRET');
  if (!secret || secret.length < 32) throw new HttpError(503, { error: 'not_configured' });
  return secret;
};

/** Optional bot check: enforced only when TURNSTILE_SECRET_KEY is configured. */
async function checkBot(deps, request, body) {
  const secret = deps.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return;
  const response = typeof body.turnstile_token === 'string' ? body.turnstile_token : '';
  if (!response || response.length > 2048) throw new HttpError(400, { error: 'bot_check_failed' });
  const form = new URLSearchParams({ secret, response, remoteip: clientIp(request) });
  const reply = await (deps.fetch || fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const result = await reply.json().catch(() => ({}));
  if (!result.success) throw new HttpError(400, { error: 'bot_check_failed' });
}

// ------------------------------------------------------------------ quote and order creation
export const quoteOrder = (deps) => endpoint({
  name: 'quote-order', deps, rate: { max: 60, windowSeconds: 60 },
  async run({ body }) {
    v.rejectUnknown(body, ['lines', 'shipping_method', 'province', 'payment_method']);
    const quote = await rpc(deps.admin, 'quote_order', {
      p_lines: v.lines(body.lines), p_shipping_method: v.code(body.shipping_method, 'shipping_method'),
      p_province: v.text(body.province, 'province', { min: 1, max: 80 }), p_payment_method: v.code(body.payment_method, 'payment_method'),
    });
    return { status: 200, body: { quote } };
  },
});

export const createOrder = (deps) => endpoint({
  name: 'create-order', deps, rate: { max: 10, windowSeconds: 60 }, auth: 'optional-user',
  async run({ request, body, userId }) {
    v.rejectUnknown(body, ['idempotency_key', 'checkout_secret', 'lines', 'shipping_method', 'payment_method', 'contact', 'address', 'expected_total_pkr', 'turnstile_token']);
    const secret = tokenSecret(deps);
    await checkBot(deps, request, body);
    const key = v.text(body.idempotency_key, 'idempotency_key', { min: 16, max: 100 });
    if (!IDEMPOTENCY_KEY.test(key)) throw new v.ValidationError('idempotency_key');
    // Guests prove ownership of a retry with a secret only their browser knows; signed-in users use their id.
    let scope;
    if (userId) scope = `user:${userId}`;
    else scope = `guest:${v.text(body.checkout_secret, 'checkout_secret', { min: 32, max: 200 })}`;
    const scopeHash = await sha256(scope);
    const scopeHex = toHex(scopeHash);
    const orderId = crypto.randomUUID();
    const token = await orderAccessToken(secret, orderId, scopeHex);
    const payload = {
      lines: v.lines(body.lines), shipping_method: v.code(body.shipping_method, 'shipping_method'), payment_method: v.code(body.payment_method, 'payment_method'),
      contact: v.contact(body.contact), address: v.address(body.address),
    };
    // Per-contact limit (on top of the per-IP limit) so one person cannot tie up stock with many unpaid orders.
    const contactKey = toHex(await sha256(`${String(payload.contact.email || payload.contact.phone || '').toLowerCase()}:${secret}`));
    if (!(await hit(deps, `create-order-contact:${contactKey}`, 8, 3600))) throw new HttpError(429, { error: 'rate_limited' });
    const expected = v.integer(body.expected_total_pkr, 'expected_total_pkr', { min: 0, max: 1000000000 });
    const result = await rpc(deps.admin, 'create_order', {
      p_order_id: orderId, p_user_id: userId, p_scope_hash: toBytea(scopeHash), p_idempotency_key: key, p_payload: payload,
      p_expected_total: expected, p_token_hash: toBytea(await sha256(token)),
      // Previews and staging mark every order as a test order so it can never count as revenue.
      p_is_test: deps.env.get('ORDER_TEST_MODE') === 'true',
    });
    // On a replay the original order's capability is recomputed (deterministic), never stored.
    const accessToken = result.replayed ? await orderAccessToken(secret, result.order_id, scopeHex) : token;
    return {
      status: result.replayed ? 200 : 201,
      body: {
        order_number: result.order_number, payment_status: result.payment_status, fulfilment_status: result.fulfilment_status,
        total_pkr: result.total_pkr, replayed: result.replayed, payment_method: result.payment_method ?? null, expires_at: result.expires_at ?? null,
        access_token: accessToken,
      },
    };
  },
});

// ------------------------------------------------------------------ guest / customer order lookup
export const orderStatus = (deps) => endpoint({
  name: 'order-status', deps, rate: { max: 20, windowSeconds: 60 },
  async run({ body }) {
    v.rejectUnknown(body, ['order_number', 'access_token']);
    const number = typeof body.order_number === 'string' ? body.order_number.trim().toUpperCase() : '';
    const token = typeof body.access_token === 'string' ? body.access_token.trim() : '';
    if (!ORDER_NUMBER.test(number) || !ACCESS_TOKEN.test(token)) throw new HttpError(404, { error: 'not_found' });
    // A second, per-order limiter stops an attacker from rotating IPs to guess one order's token.
    if (!(await hit(deps, `order-status:${number}`, 10, 60))) throw new HttpError(429, { error: 'rate_limited' });
    const order = await rpc(deps.admin, 'get_order_for_access', { p_order_number: number, p_token_hash: toBytea(await sha256(token)) });
    if (!order) throw new HttpError(404, { error: 'not_found' });
    return { status: 200, body: { order } };
  },
});

// ------------------------------------------------------------------ contact and newsletter
export const submitContact = (deps) => endpoint({
  name: 'submit-contact', deps, rate: { max: 5, windowSeconds: 600 },
  async run({ request, body }) {
    v.rejectUnknown(body, ['first_name', 'last_name', 'email', 'phone', 'topics', 'message', 'kind', 'order_number', 'website', 'turnstile_token']);
    // Honeypot: real visitors never fill the hidden "website" field. Bots get a normal-looking reply and nothing is stored.
    if (typeof body.website === 'string' && body.website.trim() !== '') return { status: 200, body: { saved: true } };
    await checkBot(deps, request, body);
    const topics = Array.isArray(body.topics) ? body.topics.slice(0, 8).map((t, i) => v.text(t, `topics[${i}]`, { min: 1, max: 40 })) : [];
    const kind = body.kind === 'return_request' ? 'return_request' : 'contact';
    await rpc(deps.admin, 'submit_contact', {
      p_payload: {
        kind, first_name: v.text(body.first_name, 'first_name', { min: 1, max: 80 }), last_name: v.text(body.last_name, 'last_name', { max: 80 }),
        email: v.email(body.email), phone: v.phone(body.phone, 'phone', { optional: true }), topics,
        order_number: v.text(body.order_number, 'order_number', { max: 40 }), message: v.text(body.message, 'message', { min: 1, max: 4000 }),
      },
    });
    // "saved" is all this confirms: no email has been sent to anyone.
    return { status: 201, body: { saved: true } };
  },
});

export const newsletterSubscribe = (deps) => endpoint({
  name: 'newsletter-subscribe', deps, rate: { max: 5, windowSeconds: 600 },
  async run({ request, body }) {
    v.rejectUnknown(body, ['email', 'consent', 'consent_text', 'source', 'website', 'turnstile_token']);
    if (typeof body.website === 'string' && body.website.trim() !== '') return { status: 200, body: { saved: true } };
    if (body.consent !== true) throw new HttpError(400, { error: 'consent_required' });
    const secret = tokenSecret(deps);
    await checkBot(deps, request, body);
    const email = v.email(body.email);
    await rpc(deps.admin, 'newsletter_subscribe', {
      p_email: email, p_consent_text: v.text(body.consent_text, 'consent_text', { min: 1, max: 500 }),
      p_source: v.text(body.source, 'source', { max: 40 }) || 'footer', p_token_hash: toBytea(await sha256(await newsletterToken(secret, email))),
    });
    // Identical response whether or not the address was already subscribed.
    return { status: 201, body: { saved: true } };
  },
});

export const newsletterUnsubscribe = (deps) => endpoint({
  name: 'newsletter-unsubscribe', deps, rate: { max: 10, windowSeconds: 600 },
  async run({ body }) {
    v.rejectUnknown(body, ['token']);
    if (typeof body.token !== 'string' || !ACCESS_TOKEN.test(body.token)) throw new HttpError(400, { error: 'invalid_token' });
    const ok = await rpc(deps.admin, 'newsletter_unsubscribe', { p_token_hash: toBytea(await sha256(body.token)) });
    return { status: 200, body: { unsubscribed: ok === true } };
  },
});

// ------------------------------------------------------------------ scheduled and provider endpoints
const isCron = (deps, request) => {
  const secret = deps.env.get('CRON_SECRET');
  const given = request.headers.get('x-cron-secret');
  return Boolean(secret && secret.length >= 24 && given && safeEqual(given, secret));
};

async function requireCronOrAdmin(deps, request) {
  if (isCron(deps, request)) return;
  await requireAdmin(deps, bearerToken(request));
}

export const maintenance = (deps) => endpoint({
  name: 'maintenance', deps, rate: { max: 6, windowSeconds: 60 }, body: false,
  async run({ request }) {
    await requireCronOrAdmin(deps, request);
    return { status: 200, body: { result: await rpc(deps.admin, 'run_maintenance', {}) } };
  },
});

/**
 * Sends queued notifications through a configured provider. With no provider configured nothing is claimed
 * or changed (so queued messages are never lost or marked sent): the response says so.
 * deps.mailer, when present, is { send(kind, payload) -> Promise<void> } supplied by a verified adapter.
 */
export const processOutbox = (deps) => endpoint({
  name: 'process-outbox', deps, rate: { max: 6, windowSeconds: 60 }, body: false,
  async run({ request }) {
    await requireCronOrAdmin(deps, request);
    if (!deps.mailer) return { status: 200, body: { provider: 'not_configured', sent: 0, failed: 0 } };
    const batch = await rpc(deps.admin, 'claim_outbox', { p_limit: 10 });
    let sent = 0; let failed = 0;
    for (const row of batch || []) {
      try {
        await deps.mailer.send(row.kind, row.payload);
        await rpc(deps.admin, 'finish_outbox', { p_id: row.id, p_status: 'sent', p_error: null });
        sent += 1;
      } catch (error) {
        await rpc(deps.admin, 'finish_outbox', { p_id: row.id, p_status: 'failed', p_error: String(error?.message || 'send failed').slice(0, 200) });
        failed += 1;
      }
    }
    return { status: 200, body: { provider: 'configured', sent, failed } };
  },
});

/**
 * Payment provider webhooks. No provider is selected yet, so every call is refused honestly.
 * To add one: verify the signature against the RAW body (see verifyHmacSignature in crypto.js), then call the
 * apply_payment_event RPC (it dedupes events, checks amount and currency, and commits or releases stock).
 */
export const paymentWebhook = (deps) => endpoint({
  name: 'payment-webhook', deps, rate: { max: 120, windowSeconds: 60 }, body: false,
  async run() {
    return { status: 501, body: { error: 'payment_provider_not_configured' } };
  },
});
