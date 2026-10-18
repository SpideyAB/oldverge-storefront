// Hashing and token helpers (Web Crypto: available in Deno and Node 20+).

const encoder = new TextEncoder();

export const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const toBase64Url = (bytes) => {
  let binary = '';
  new Uint8Array(bytes).forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function sha256(value) {
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/** PostgREST accepts bytea as a "\x<hex>" string. */
export const toBytea = (bytes) => `\\x${toHex(bytes)}`;

export async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/**
 * Guest order access token. Deterministic for (order, scope) so a retry of the same checkout can recover
 * the same link without the server ever storing the token: only its SHA-256 is saved in the database.
 */
export async function orderAccessToken(secret, orderId, scopeHashHex) {
  return toBase64Url(await hmacSha256(secret, `order:${orderId}:${scopeHashHex}`));
}

export async function newsletterToken(secret, email) {
  return toBase64Url(await hmacSha256(secret, `newsletter:${String(email).trim().toLowerCase()}`));
}

/** Constant-time comparison of two strings. */
export function safeEqual(a, b) {
  const x = encoder.encode(String(a)); const y = encoder.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** Verifies "sha256=<hex>" style HMAC signatures over the RAW request body (for provider webhooks). */
export async function verifyHmacSignature(rawBody, headerValue, secret) {
  if (!headerValue || !secret) return false;
  const provided = String(headerValue).replace(/^sha256=/i, '').trim().toLowerCase();
  const expected = toHex(await hmacSha256(secret, rawBody));
  return safeEqual(provided, expected);
}
