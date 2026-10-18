import { backend } from './config.js';
import { supabase } from './supabase.js';

const TIMEOUT_MS = 20000;

/**
 * Calls a Supabase Edge Function. The API key goes in the `apikey` header (it only routes the request);
 * the caller's identity is the user session token, if there is one. Returns
 *   { ok, status, data }                 on any HTTP answer (data is the parsed JSON body)
 *   { ok: false, status: 0, data: { error } }   when the network or the timeout fails
 */
export async function callFunction(name, body, { token, signal, method = 'POST', rawBody, contentType, query } = {}) {
  if (!backend.configured) return { ok: false, status: 0, data: { error: 'backend_not_configured' } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  let accessToken = token;
  if (accessToken === undefined && supabase) {
    const { data } = await supabase.auth.getSession();
    accessToken = data.session?.access_token;
  }
  const headers = { apikey: backend.key };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (rawBody === undefined) headers['Content-Type'] = 'application/json'; else if (contentType) headers['Content-Type'] = contentType;
  const search = query ? `?${new URLSearchParams(query)}` : '';
  try {
    const response = await fetch(`${backend.functionsUrl}/${name}${search}`, {
      method, headers, signal: controller.signal, body: rawBody !== undefined ? rawBody : JSON.stringify(body ?? {}),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: 'invalid_response' }; }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'network_error' } };
  } finally {
    clearTimeout(timer);
  }
}
