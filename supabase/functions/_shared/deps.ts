// Deno-only wiring: builds the clients and environment accessor used by the shared handlers.
// Names below are the ones Supabase provides to every Edge Function (SUPABASE_URL, SUPABASE_SECRET_KEYS,
// SUPABASE_PUBLISHABLE_KEYS, plus the legacy SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY as a fallback).
// Custom secrets (TOKEN_SECRET, ALLOWED_ORIGINS, CRON_SECRET, TURNSTILE_SECRET_KEY, ORDER_TEST_MODE) are set with
// `supabase secrets set` and are NEVER exposed to the browser.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const firstKey = (name: string, legacy: string): string | undefined => {
  try {
    const dict = JSON.parse(Deno.env.get(name) ?? '{}');
    if (dict.default) return dict.default;
    const first = Object.values(dict)[0];
    if (typeof first === 'string') return first;
  } catch { /* fall through to the legacy variable */ }
  return Deno.env.get(legacy) ?? undefined;
};

export function buildDeps() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const secretKey = firstKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')!;
  const publishableKey = firstKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    env: { get: (name: string) => Deno.env.get(name) ?? null },
    admin: createClient(url, secretKey, options),
    userClient: (token: string) => createClient(url, publishableKey, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } }),
    fetch,
  };
}