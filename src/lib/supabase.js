import { createClient } from '@supabase/supabase-js';
import { backend } from './config.js';

/** The single browser Supabase client (publishable key, user session in localStorage). null in demo mode. */
export const supabase = backend.configured
  ? createClient(backend.url, backend.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  })
  : null;

export const requireSupabase = () => {
  if (!supabase) throw new Error('backend_not_configured');
  return supabase;
};
