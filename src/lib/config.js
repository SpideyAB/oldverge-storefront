// Runtime configuration. Only PUBLIC values may come from VITE_* variables: Vite inlines them into the
// browser bundle. The publishable key is public by design; a secret / service-role key never is.
//
// Two explicit modes, never mixed:
//   'supabase'  every business flow (catalogue, cart pricing, checkout, accounts, support, admin) uses the backend.
//               If the backend is unreachable the UI shows an unavailable state. It never falls back to sample data.
//   'demo'      VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set. The original sample storefront runs,
//               clearly labelled as a demonstration, and nothing in it is stored or sent anywhere.

const decodeJwtRole = (token) => {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
};

/** Returns { ok, reason } for a candidate browser key. Rejects anything that looks like a privileged credential. */
export function checkPublicKey(key) {
  if (typeof key !== 'string' || key.length < 20) return { ok: false, reason: 'missing' };
  if (/^sb_secret_/i.test(key)) return { ok: false, reason: 'secret_key_in_browser_variable' };
  if (key.split('.').length === 3 && decodeJwtRole(key) === 'service_role') return { ok: false, reason: 'service_role_key_in_browser_variable' };
  return { ok: true, reason: null };
}

export function checkProjectUrl(url, { dev = false } = {}) {
  try {
    const parsed = new URL(url);
    const local = dev && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) return { ok: false, reason: 'url_must_be_https' };
    return { ok: true, reason: null, origin: parsed.origin };
  } catch {
    return { ok: false, reason: 'missing' };
  }
}

export function resolveBackend(env, { dev = false } = {}) {
  const rawUrl = env.VITE_SUPABASE_URL;
  const rawKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!rawUrl && !rawKey) return { mode: 'demo', configured: false, issue: null };
  const url = checkProjectUrl(rawUrl, { dev });
  const key = checkPublicKey(rawKey);
  if (!url.ok || !key.ok) {
    // A half-set or unsafe configuration is reported, never silently ignored and never used.
    return { mode: 'demo', configured: false, issue: !url.ok ? url.reason : key.reason };
  }
  return { mode: 'supabase', configured: true, issue: null, url: url.origin, key: rawKey, functionsUrl: `${url.origin}/functions/v1` };
}

export const backend = resolveBackend(import.meta.env, { dev: import.meta.env.DEV });
export const isBackend = backend.mode === 'supabase';

if (backend.issue && typeof console !== 'undefined') {
  console.error(`OLDVERGE: the Supabase configuration was ignored (${backend.issue}). Running in demo mode.`);
}
