// Checkout helpers for the Supabase-backed checkout: build the server payload, keep ONE idempotency key per
// distinct request (so a double click or a retry after a lost response can never create two orders) and translate
// server answers into clear next steps. Prices and totals always come from the server; nothing here decides them.
import { callFunction } from './api.js';
import { variantFor } from '../data/catalogMapper.js';

export const ATTEMPT_KEY = 'ov-checkout-attempt';

const base64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (size = 32) => base64Url(crypto.getRandomValues(new Uint8Array(size)));

/** Cart lines -> server lines. Fails (never guesses) if an option no longer maps to a purchasable variant. */
export function toOrderLines(lines) {
  const out = [];
  for (const line of lines) {
    const variant = variantFor(line.product, line.size, line.color);
    if (!variant) return { ok: false, line };
    out.push({ variant_id: variant.id, quantity: line.quantity });
  }
  return { ok: true, lines: out };
}

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  return value;
};

/** A stable hash of the request, so the idempotency key changes exactly when the request changes. */
export async function payloadFingerprint(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(sortKeys(payload)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const read = (storage) => { try { return JSON.parse(storage.getItem(ATTEMPT_KEY) || 'null'); } catch { return null; } };

/**
 * Returns { key, secret } for this request. The same fingerprint reuses the same key (safe retry); a changed
 * request gets a fresh key. The secret proves guest ownership of a retry and never leaves this browser tab
 * except in the request itself. Only these opaque values are stored: no addresses, no cart, no prices.
 */
export function attemptFor(storage, source, fingerprint) {
  const saved = read(storage);
  const secret = saved?.secret && saved.secret.length >= 32 ? saved.secret : randomToken(32);
  const reuse = saved && saved.source === source && saved.fingerprint === fingerprint && saved.key;
  const attempt = { source, fingerprint, secret, key: reuse ? saved.key : randomToken(24) };
  try { storage.setItem(ATTEMPT_KEY, JSON.stringify(attempt)); } catch { /* private mode: retries simply use a new key */ }
  return { key: attempt.key, secret: attempt.secret };
}

export const clearAttempt = (storage) => { try { storage.removeItem(ATTEMPT_KEY); } catch { /* nothing to clear */ } };

export const FIELD_LABELS = {
  'contact.email': 'email address', 'contact.phone': 'phone number', 'contact.name': 'name', 'address.line1': 'street address',
  'address.city': 'city', 'address.province': 'province', 'address.postal_code': 'postal code', 'address.phone': 'phone number', 'address.line2': 'address line 2',
};

/** Maps a function answer to { kind, message, ... } so the page can react precisely. */
export function explainOrderError(status, data) {
  const error = data?.error;
  if (status === 0) return { kind: 'network', message: 'We could not reach the server. Nothing was charged. Check your connection and try again: retrying is safe and will not create a second order.' };
  if (status === 429) return { kind: 'rate', message: 'Too many attempts. Please wait a minute and try again.' };
  if (status === 401) return { kind: 'session', message: 'Your sign-in has expired. Sign in again, or continue as a guest by signing out.' };
  if (status === 503) return { kind: 'unavailable', message: 'Ordering is temporarily unavailable. Please try again later.' };
  if (error === 'ordering_closed') return { kind: 'closed', message: 'Orders are not open yet.' };
  if (error === 'price_changed') return { kind: 'price_changed', quote: data.details, message: 'The total changed while you were checking out. Please review the new total and confirm again.' };
  if (error === 'insufficient_stock' || error === 'variant_unavailable') {
    return { kind: 'stock', variantId: data?.details?.variant_id, message: error === 'insufficient_stock' ? 'One of the items is no longer available in that quantity.' : 'One of the items is no longer available.' };
  }
  if (error === 'shipping_unavailable') return { kind: 'shipping', message: 'We cannot deliver with that method to this address. Choose another delivery method or check the province.' };
  if (error === 'payment_method_unavailable') return { kind: 'payment', message: 'That payment method is not available. Choose another one.' };
  if (error === 'idempotency_conflict') return { kind: 'restart', message: 'Your details changed after the last attempt. Please review them and place the order again.' };
  if (error === 'request_in_progress') return { kind: 'wait', message: 'Your order is still being processed. Please wait a moment and press the button again.' };
  if (error === 'invalid_field') {
    const label = FIELD_LABELS[data.field];
    return { kind: 'field', field: data.field, message: label ? `Please check your ${label}.` : 'Please check the details you entered.' };
  }
  if (error === 'not_configured') return { kind: 'unavailable', message: 'Ordering is not set up yet.' };
  return { kind: 'unknown', message: 'Something went wrong. Please try again.' };
}

export const requestQuote = (body) => callFunction('quote-order', body);
export const submitOrder = (body, token) => callFunction('create-order', body, token === undefined ? {} : { token });
export const fetchOrderByAccess = (orderNumber, accessToken) => callFunction('order-status', { order_number: orderNumber, access_token: accessToken }, { token: null });

/** The confirmation link carries the capability in the URL FRAGMENT, which browsers never send to servers. */
export const confirmationHash = (orderNumber, accessToken) => `#o=${encodeURIComponent(orderNumber)}&t=${encodeURIComponent(accessToken)}`;

export function parseConfirmationHash(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const order = params.get('o'); const token = params.get('t');
  return order && token ? { order, token } : null;
}
