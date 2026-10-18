// Common request pipeline for JSON endpoints: CORS preflight, method check, persistent rate limiting,
// bounded JSON parsing, optional/required user authentication, uniform error mapping and request ids.
//
// deps = { env: { get(name) }, admin, userClient(token) }
//   admin: a service-role client (bypasses RLS: only ever used for narrowly granted RPCs)
//   userClient(token): a client acting as that user (RLS applies)
// The functions use verify_jwt = false (see supabase/config.toml) because publishable API keys are not JWTs:
// the caller is identified only by the user session token validated here, never by the API key.

import { bearerToken, clientIp, json, preflight, readJson, requestId as newRequestId } from './http.js';
import { sha256, toHex } from './crypto.js';
import { logFailure, mapDbError } from './errors.js';
import { ValidationError } from './validate.js';

export class HttpError extends Error {
  constructor(status, body) { super(body.error); this.status = status; this.body = body; }
}

async function rateLimitKey(deps, name, request) {
  const salt = deps.env.get('TOKEN_SECRET') || 'oldverge';
  return `${name}:${toHex(await sha256(`${clientIp(request)}:${salt}`))}`;
}

/** Fails closed: if the limiter cannot answer, the request is refused. */
export async function hit(deps, key, max, windowSeconds) {
  const { data, error } = await deps.admin.rpc('hit_rate_limit', { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  return !error && data === true;
}

export async function identifyUser(deps, token) {
  const { data, error } = await deps.admin.auth.getUser(token);
  if (error || !data?.user?.id) throw new HttpError(401, { error: 'invalid_session' });
  return data.user.id;
}

export async function requireAdmin(deps, token) {
  if (!token) throw new HttpError(401, { error: 'authentication_required' });
  const userId = await identifyUser(deps, token);
  const { data, error } = await deps.userClient(token).rpc('is_admin');
  if (error || data !== true) throw new HttpError(403, { error: 'forbidden' });
  return userId;
}

export function endpoint({ name, deps, rate = { max: 30, windowSeconds: 60 }, auth = 'none', run, body: parseBody = true }) {
  return async (request) => {
    const env = deps.env;
    if (request.method === 'OPTIONS') return preflight(request, env);
    const rid = newRequestId();
    const reply = (status, payload, extra) => json(status, { ...payload, ...(status >= 500 ? { request_id: rid } : {}) }, request, env, { 'X-Request-Id': rid, ...extra });
    try {
      if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' });
      if (rate && !(await hit(deps, await rateLimitKey(deps, name, request), rate.max, rate.windowSeconds))) {
        return reply(429, { error: 'rate_limited' }, { 'Retry-After': String(rate.windowSeconds) });
      }
      let data = {};
      if (parseBody) {
        const parsed = await readJson(request);
        if (!parsed.ok) return reply(parsed.status, { error: parsed.error });
        data = parsed.data;
      }
      const token = bearerToken(request);
      let userId = null;
      if (auth === 'optional-user' && token) userId = await identifyUser(deps, token);
      if (auth === 'user') {
        if (!token) throw new HttpError(401, { error: 'authentication_required' });
        userId = await identifyUser(deps, token);
      }
      if (auth === 'admin') userId = await requireAdmin(deps, token);
      const result = await run({ request, body: data, userId, token, requestId: rid, deps });
      return reply(result.status, result.body, result.headers);
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, error.body);
      if (error instanceof ValidationError) return reply(400, { error: 'invalid_field', field: error.field });
      if (error?.dbError) {
        const mapped = mapDbError(error.dbError, rid);
        if (mapped.status >= 500) logFailure(name, rid, error.dbError);
        return reply(mapped.status, mapped.body);
      }
      logFailure(name, rid, error);
      return reply(500, { error: 'internal' });
    }
  };
}

/** Calls an RPC and throws a mappable error on failure. Retries once on deadlock/serialization failures. */
export async function rpc(client, fn, args) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await client.rpc(fn, args);
    if (!error) return data;
    if (attempt === 0 && (error.code === '40P01' || error.code === '40001')) continue;
    const wrapped = new Error(error.message);
    wrapped.dbError = error;
    throw wrapped;
  }
  return null;
}
