// Customer authentication (Supabase Auth). One small zustand store, no tokens kept outside supabase-js.
//
// Every action returns { ok: true, ... } or { ok: false, error: <stable code>, message: <short safe text> }.
// In demo mode (no Supabase project configured) `supabase` is null and every action answers
// { ok: false, error: 'backend_not_configured' } instead of pretending to work.
//
// Privacy rules:
//   * Sign-up and password-reset answers are neutral: they never say whether an e-mail address is registered.
//   * Sign-in says only "email or password is not correct".
//   * Password rules below mirror supabase/config.toml ([auth] minimum_password_length = 10, upper + lower + digit).
//     They give early feedback only; the server is the authority and its answer is mapped by mapAuthError.

import { create } from 'zustand';
import { supabase } from './supabase.js';

export const PASSWORD_MIN_LENGTH = 10;
// bcrypt (used by Supabase Auth) ignores everything after 72 bytes, so longer passwords are refused early.
export const PASSWORD_MAX_LENGTH = 72;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const RESET_PATH = '/account/reset-password';

export const MESSAGES = {
  backend_not_configured: 'Accounts are not available on this site yet.',
  invalid_credentials: 'Email or password is not correct.',
  email_not_confirmed: 'Confirm your email address first, using the link in the confirmation email, then sign in.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  weak_password: `Choose a stronger password: at least ${PASSWORD_MIN_LENGTH} characters with an upper case letter, a lower case letter and a number.`,
  same_password: 'Choose a password that is different from your current one.',
  session_expired: 'Your session has expired. Please sign in again.',
  signup_disabled: 'Registration is not available right now.',
  invalid_input: 'Check the details you entered and try again.',
  network_error: 'We could not reach the server. Check your connection and try again.',
  user_already_exists: 'If this address can be registered, you will receive a confirmation email.',
  unknown: 'Something went wrong. Please try again.',
};

/** Returns a list of unmet password rules (empty when the password is acceptable). */
export function passwordProblems(password) {
  const value = typeof password === 'string' ? password : '';
  const problems = [];
  if (value.length < PASSWORD_MIN_LENGTH) problems.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[a-z]/.test(value)) problems.push('a lower case letter');
  if (!/[A-Z]/.test(value)) problems.push('an upper case letter');
  if (!/[0-9]/.test(value)) problems.push('a number');
  if (value.length > PASSWORD_MAX_LENGTH) problems.push(`no more than ${PASSWORD_MAX_LENGTH} characters`);
  return problems;
}

/** null when valid, otherwise one short sentence naming what is missing. */
export function validatePassword(password) {
  const problems = passwordProblems(password);
  if (!problems.length) return null;
  return `Your password needs ${problems.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
}

export function validateEmail(email) {
  const value = typeof email === 'string' ? email.trim() : '';
  if (!value) return 'Enter your email address.';
  if (value.length > 254 || !EMAIL_RE.test(value)) return 'Enter a valid email address.';
  return null;
}

/**
 * Maps a Supabase Auth error (or a thrown error) to { error, message }. Nothing from the raw error is shown.
 * Unknown-user style answers collapse into invalid_credentials so an address is never confirmed or denied.
 */
export function mapAuthError(error) {
  if (!error) return { error: 'unknown', message: MESSAGES.unknown };
  if (error.message === 'backend_not_configured') return { error: 'backend_not_configured', message: MESSAGES.backend_not_configured };
  const code = typeof error.code === 'string' ? error.code : '';
  const status = Number(error.status) || 0;
  const name = typeof error.name === 'string' ? error.name : '';
  const text = typeof error.message === 'string' ? error.message : '';
  let key = 'unknown';
  if (['invalid_credentials', 'user_not_found', 'user_banned', 'invalid_grant'].includes(code)) key = 'invalid_credentials';
  else if (code === 'email_not_confirmed') key = 'email_not_confirmed';
  else if (['over_request_rate_limit', 'over_email_send_rate_limit', 'over_sms_send_rate_limit'].includes(code) || status === 429) key = 'rate_limited';
  else if (code === 'weak_password') key = 'weak_password';
  else if (code === 'same_password') key = 'same_password';
  else if (['user_already_exists', 'email_exists'].includes(code)) key = 'user_already_exists';
  else if (code === 'signup_disabled' || code === 'email_provider_disabled') key = 'signup_disabled';
  else if (['validation_failed', 'email_address_invalid', 'bad_json'].includes(code)) key = 'invalid_input';
  else if (['session_not_found', 'session_expired', 'refresh_token_not_found', 'refresh_token_already_used', 'bad_jwt', 'no_authorization', 'reauthentication_needed'].includes(code)
    || name === 'AuthSessionMissingError' || status === 401) key = 'session_expired';
  else if (name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|network request failed|load failed/i.test(text)) key = 'network_error';
  return { error: key, message: MESSAGES[key] };
}

const fail = (error) => {
  const mapped = mapAuthError(error);
  return { ok: false, error: mapped.error, message: mapped.message };
};
const notConfigured = () => ({ ok: false, error: 'backend_not_configured', message: MESSAGES.backend_not_configured });

/** Only what the UI needs from the Supabase user. Never the access token. */
export const toUser = (raw) => (raw && raw.id
  ? { id: raw.id, email: raw.email || '', fullName: typeof raw.user_metadata?.full_name === 'string' ? raw.user_metadata.full_name : '' }
  : null);

const sameUser = (a, b) => (a === b) || (a && b && a.id === b.id && a.email === b.email && a.fullName === b.fullName);

let initPromise = null;
let subscription = null;

/** Test helper: forgets the init state so init() can run again against another mock. */
export function resetAuthForTests() {
  if (subscription) { try { subscription.unsubscribe(); } catch { /* already gone */ } }
  subscription = null;
  initPromise = null;
  useAuth.setState({ status: 'loading', user: null, recovery: false });
}

export const useAuth = create((set, get) => {
  const apply = (event, session) => {
    const next = toUser(session?.user);
    const current = get().user;
    set({
      status: next ? 'signed-in' : 'signed-out',
      user: sameUser(current, next) ? current : next,
      recovery: event === 'PASSWORD_RECOVERY' ? true : (event === 'SIGNED_OUT' || !next) ? false : get().recovery,
    });
  };

  return {
    status: 'loading', // 'loading' | 'signed-in' | 'signed-out'
    user: null, // { id, email, fullName } | null
    recovery: false, // true once Supabase reported a PASSWORD_RECOVERY event for this page load

    /** Idempotent. Reads the stored session once and keeps the store in step with Supabase afterwards. */
    init() {
      if (!supabase) {
        set({ status: 'signed-out', user: null, recovery: false });
        return Promise.resolve();
      }
      if (initPromise) return initPromise;
      initPromise = (async () => {
        // The listener is registered first so no event is missed. Callbacks stay synchronous (supabase-js
        // can deadlock when a callback awaits another auth call).
        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => apply(event, session));
        subscription = listener?.subscription || null;
        try {
          const { data } = await supabase.auth.getSession();
          // getSession resolves after supabase-js finished any code exchange from the URL (password recovery).
          apply('INITIAL_SESSION', data?.session);
        } catch {
          apply('INITIAL_SESSION', null);
        }
      })();
      return initPromise;
    },

    async signIn(email, password) {
      if (!supabase) return notConfigured();
      const problem = validateEmail(email);
      if (problem || !password) return { ok: false, error: 'invalid_input', message: MESSAGES.invalid_input };
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) return fail(error);
        apply('SIGNED_IN', data.session);
        return { ok: true };
      } catch (error) {
        return fail(error);
      }
    },

    /**
     * Always answers neutrally. `ok: true` means only "the request was accepted"; it does not say the address is
     * new, nor that an e-mail was delivered.
     */
    async signUp(email, password, fullName) {
      if (!supabase) return notConfigured();
      if (validateEmail(email) || validatePassword(password)) return { ok: false, error: 'invalid_input', message: MESSAGES.invalid_input };
      try {
        // No emailRedirectTo: the confirmation link goes to the project's configured Site URL, which is always allowed.
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password, options: { data: { full_name: String(fullName || '').trim().slice(0, 80) } },
        });
        if (error) {
          const mapped = mapAuthError(error);
          if (mapped.error === 'user_already_exists') return { ok: true, neutral: true };
          return { ok: false, error: mapped.error, message: mapped.message };
        }
        // With e-mail confirmation switched off Supabase returns a session straight away.
        if (data?.session) apply('SIGNED_IN', data.session);
        return { ok: true, neutral: true };
      } catch (error) {
        return fail(error);
      }
    },

    async signOut() {
      set({ status: 'signed-out', user: null, recovery: false });
      if (!supabase) return { ok: true };
      try {
        // 'local' ends this browser's session only and still clears local storage if the server cannot be reached.
        await supabase.auth.signOut({ scope: 'local' });
      } catch { /* the local state is already cleared */ }
      return { ok: true };
    },

    /** Neutral by design: the same answer whether or not the address has an account. */
    async requestPasswordReset(email) {
      if (!supabase) return notConfigured();
      if (validateEmail(email)) return { ok: false, error: 'invalid_input', message: 'Enter a valid email address.' };
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}${RESET_PATH}` });
        if (error) {
          const mapped = mapAuthError(error);
          // Rate limits and network failures are safe to show; anything else stays neutral.
          if (mapped.error === 'rate_limited' || mapped.error === 'network_error') return { ok: false, error: mapped.error, message: mapped.message };
        }
        return { ok: true, neutral: true };
      } catch (error) {
        const mapped = mapAuthError(error);
        if (mapped.error === 'network_error') return { ok: false, error: mapped.error, message: mapped.message };
        return { ok: true, neutral: true };
      }
    },

    /** Sets a new password for the current session (a recovery session or a normal one). */
    async updatePassword(newPassword) {
      if (!supabase) return notConfigured();
      const problem = validatePassword(newPassword);
      if (problem) return { ok: false, error: 'weak_password', message: problem };
      try {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) return fail(error);
        set({ recovery: false });
        return { ok: true };
      } catch (error) {
        return fail(error);
      }
    },

    /** Profile page: re-checks the current password first, then sets the new one. */
    async changePassword(currentPassword, newPassword) {
      if (!supabase) return notConfigured();
      const email = get().user?.email;
      if (!email) return { ok: false, error: 'session_expired', message: MESSAGES.session_expired };
      if (!currentPassword) return { ok: false, error: 'invalid_credentials', message: 'Enter your current password.' };
      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
        if (error) {
          const mapped = mapAuthError(error);
          return mapped.error === 'invalid_credentials'
            ? { ok: false, error: 'invalid_credentials', message: 'Your current password is not correct.' }
            : { ok: false, error: mapped.error, message: mapped.message };
        }
      } catch (error) {
        return fail(error);
      }
      return get().updatePassword(newPassword);
    },
  };
});
