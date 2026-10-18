// HTTP helpers shared by every Edge Function. Plain Web APIs only, so the same code runs in Deno and in the
// Node-based tests. CORS is NOT authorization or rate limiting: it only tells browsers which storefront
// origins may read responses.

export const MAX_JSON_BYTES = 64 * 1024;

const parseOrigins = (env) => String(env.get('ALLOWED_ORIGINS') || '')
  .split(',').map((value) => value.trim()).filter(Boolean);

export function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && parseOrigins(env).includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function json(status, body, request, env, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request, env), ...extra },
  });
}

export const preflight = (request, env) => new Response(null, { status: 204, headers: corsHeaders(request, env) });

/** Reads a bounded JSON object body. Returns { ok: true, data } or { ok: false, status, error }. */
export async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  const type = request.headers.get('content-type') || '';
  if (!/^application\/json\b/i.test(type)) return { ok: false, status: 415, error: 'unsupported_media_type' };
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) return { ok: false, status: 413, error: 'payload_too_large' };
  let text;
  try { text = await request.text(); } catch { return { ok: false, status: 400, error: 'invalid_body' }; }
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413, error: 'payload_too_large' };
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return { ok: false, status: 400, error: 'invalid_body' };
    return { ok: true, data };
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' };
  }
}

export function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(header);
  return match ? match[1] : null;
}

export const clientIp = (request) => {
  // cf-connecting-ip is set by the platform's edge and cannot be supplied by the client. The first
  // X-Forwarded-For entry can, so only the last hop (appended by the nearest trusted proxy) is used as a fallback.
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',').pop().trim();
  return request.headers.get('x-real-ip') || 'unknown';
};

export const requestId = () => crypto.randomUUID();
