import { describe, expect, it } from 'vitest';
import { ATTEMPT_KEY, attemptFor, clearAttempt, confirmationHash, explainOrderError, parseConfirmationHash, payloadFingerprint, toOrderLines } from './checkout.js';

const memoryStorage = () => { const map = new Map(); return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), raw: map }; };
const product = { variants: [{ id: 'v-m', size: 'M', color: 'Black' }, { id: 'v-s', size: 'S', color: 'Black' }] };

describe('toOrderLines', () => {
  it('maps cart lines to variant ids and refuses lines with no purchasable variant', () => {
    expect(toOrderLines([{ product, size: 'M', color: 'Black', quantity: 2 }])).toEqual({ ok: true, lines: [{ variant_id: 'v-m', quantity: 2 }] });
    const bad = toOrderLines([{ product, size: 'XL', color: 'Black', quantity: 1 }]);
    expect(bad.ok).toBe(false);
  });
});

describe('idempotency attempts', () => {
  it('reuses the key for an identical request and issues a new key when the request changes', async () => {
    const storage = memoryStorage();
    const fpA = await payloadFingerprint({ b: 2, a: { y: 1, x: 0 } });
    expect(fpA).toBe(await payloadFingerprint({ a: { x: 0, y: 1 }, b: 2 }));    // key order does not matter
    const first = attemptFor(storage, 'cart', fpA);
    const retry = attemptFor(storage, 'cart', fpA);
    expect(retry).toEqual(first);
    const changed = attemptFor(storage, 'cart', await payloadFingerprint({ a: 'different' }));
    expect(changed.key).not.toBe(first.key);
    expect(changed.secret).toBe(first.secret);                                   // the browser-held secret is stable
    const otherSource = attemptFor(storage, 'buy-now', fpA);
    expect(otherSource.key).not.toBe(first.key);                                 // cart and Buy now never share a key
  });

  it('stores only opaque values, never addresses, carts or prices, and can be cleared', async () => {
    const storage = memoryStorage();
    attemptFor(storage, 'cart', await payloadFingerprint({ address: '12 Test Street', total: 123 }));
    const stored = storage.getItem(ATTEMPT_KEY);
    expect(stored).not.toMatch(/Test Street|123/);
    expect(JSON.parse(stored)).toHaveProperty('key');
    clearAttempt(storage);
    expect(storage.getItem(ATTEMPT_KEY)).toBeNull();
  });

  it('survives unavailable storage (private mode) without throwing', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(attemptFor(broken, 'cart', 'f').key).toBeTruthy();
    expect(() => clearAttempt(broken)).not.toThrow();
  });
});

describe('explainOrderError', () => {
  it('turns every server answer into a clear next step', () => {
    expect(explainOrderError(0, { error: 'network_error' }).kind).toBe('network');
    expect(explainOrderError(0, {}).message).toMatch(/retrying is safe/i);
    expect(explainOrderError(429, {}).kind).toBe('rate');
    expect(explainOrderError(401, { error: 'invalid_session' }).kind).toBe('session');
    expect(explainOrderError(403, { error: 'ordering_closed' }).kind).toBe('closed');
    const changed = explainOrderError(409, { error: 'price_changed', details: { total_pkr: 9000 } });
    expect(changed).toMatchObject({ kind: 'price_changed', quote: { total_pkr: 9000 } });
    expect(explainOrderError(409, { error: 'insufficient_stock', details: { variant_id: 'v' } })).toMatchObject({ kind: 'stock', variantId: 'v' });
    expect(explainOrderError(409, { error: 'idempotency_conflict' }).kind).toBe('restart');
    expect(explainOrderError(400, { error: 'invalid_field', field: 'contact.email' })).toMatchObject({ kind: 'field', message: 'Please check your email address.' });
    expect(explainOrderError(500, { error: 'internal' }).kind).toBe('unknown');
  });
});

describe('confirmation link', () => {
  it('keeps the capability in the URL fragment and parses it back', () => {
    const hash = confirmationHash('OV-261019-ABCDEF12', 'tok_en-123');
    expect(hash.startsWith('#')).toBe(true);
    expect(parseConfirmationHash(hash)).toEqual({ order: 'OV-261019-ABCDEF12', token: 'tok_en-123' });
    expect(parseConfirmationHash('')).toBeNull();
    expect(parseConfirmationHash('#o=OV-1')).toBeNull();
  });
});
