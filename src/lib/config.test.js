import { describe, expect, it } from 'vitest';
import { checkProjectUrl, checkPublicKey, resolveBackend } from './config.js';

const jwt = (payload) => `${btoa('{"alg":"HS256"}')}.${btoa(JSON.stringify(payload))}.signature`;

describe('backend configuration', () => {
  it('runs in explicit demo mode when nothing is configured', () => {
    expect(resolveBackend({})).toMatchObject({ mode: 'demo', configured: false, issue: null });
  });

  it('uses the backend only with an https project URL and a public key', () => {
    const ok = resolveBackend({ VITE_SUPABASE_URL: 'https://abcd.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_0123456789abcdefghij' });
    expect(ok).toMatchObject({ mode: 'supabase', configured: true, url: 'https://abcd.supabase.co', functionsUrl: 'https://abcd.supabase.co/functions/v1' });
  });

  it('refuses a secret or service-role key placed in a browser variable', () => {
    expect(checkPublicKey('sb_secret_0123456789abcdefghij')).toEqual({ ok: false, reason: 'secret_key_in_browser_variable' });
    expect(checkPublicKey(jwt({ role: 'service_role' }))).toEqual({ ok: false, reason: 'service_role_key_in_browser_variable' });
    expect(checkPublicKey(jwt({ role: 'anon' })).ok).toBe(true);
    const unsafe = resolveBackend({ VITE_SUPABASE_URL: 'https://abcd.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_0123456789abcdefghij' });
    expect(unsafe).toMatchObject({ mode: 'demo', configured: false, issue: 'secret_key_in_browser_variable' });
    expect(unsafe).not.toHaveProperty('key');
  });

  it('reports a half-set or insecure configuration instead of using it', () => {
    expect(resolveBackend({ VITE_SUPABASE_URL: 'https://abcd.supabase.co' })).toMatchObject({ configured: false, issue: 'missing' });
    expect(resolveBackend({ VITE_SUPABASE_URL: 'http://abcd.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_0123456789abcdefghij' }).issue).toBe('url_must_be_https');
    expect(checkProjectUrl('http://localhost:54321', { dev: true }).ok).toBe(true);
    expect(checkProjectUrl('http://localhost:54321', { dev: false }).ok).toBe(false);
  });
});
