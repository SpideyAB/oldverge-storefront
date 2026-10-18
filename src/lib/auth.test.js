import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ client: null }));
vi.mock('./supabase.js', () => ({ get supabase() { return mocks.client; } }));

const {
  MESSAGES, PASSWORD_MIN_LENGTH, mapAuthError, passwordProblems, resetAuthForTests, toUser, useAuth, validateEmail, validatePassword,
} = await import('./auth.js');

/** Minimal fake of the parts of supabase-js that auth.js touches. */
function fakeClient(overrides = {}) {
  const listeners = [];
  const auth = {
    onAuthStateChange: vi.fn((callback) => { listeners.push(callback); return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    getSession: vi.fn(async () => ({ data: { session: null } })),
    signInWithPassword: vi.fn(async () => ({ data: { session: { user: { id: 'u1', email: 'a@b.co', user_metadata: { full_name: 'Ada' } } } }, error: null })),
    signUp: vi.fn(async () => ({ data: { user: { id: 'u2' }, session: null }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    updateUser: vi.fn(async () => ({ data: {}, error: null })),
    ...overrides,
  };
  return { auth, emit: (event, session) => listeners.forEach((callback) => callback(event, session)) };
}

beforeEach(() => {
  globalThis.window = { location: { origin: 'https://shop.example' } };
  mocks.client = null;
  resetAuthForTests();
});

describe('password rules (mirror supabase/config.toml)', () => {
  it('requires length, lower case, upper case and a digit', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(passwordProblems('Abcdefghi1')).toEqual([]);
    expect(passwordProblems('Abcdefgh1')).toEqual(['at least 10 characters']);
    expect(passwordProblems('abcdefghij1')).toEqual(['an upper case letter']);
    expect(passwordProblems('ABCDEFGHIJ1')).toEqual(['a lower case letter']);
    expect(passwordProblems('Abcdefghijk')).toEqual(['a number']);
    expect(passwordProblems(undefined)).toHaveLength(4);
  });

  it('refuses passwords longer than 72 characters (bcrypt limit)', () => {
    expect(validatePassword(`Aa1${'x'.repeat(69)}`)).toBeNull();
    expect(validatePassword(`Aa1${'x'.repeat(70)}`)).toMatch(/no more than 72/);
  });

  it('produces one readable sentence', () => {
    expect(validatePassword('short')).toBe('Your password needs at least 10 characters, an upper case letter and a number.');
    expect(validatePassword('Abcdefghi1')).toBeNull();
  });
});

describe('validateEmail', () => {
  it('accepts normal addresses and rejects empty or malformed ones', () => {
    expect(validateEmail(' a@b.co ')).toBeNull();
    expect(validateEmail('')).toMatch(/Enter your email/);
    expect(validateEmail('nope')).toMatch(/valid email/);
    expect(validateEmail(`${'a'.repeat(250)}@b.co`)).toMatch(/valid email/);
  });
});

describe('mapAuthError', () => {
  const cases = [
    [{ code: 'invalid_credentials', status: 400 }, 'invalid_credentials'],
    [{ code: 'user_not_found' }, 'invalid_credentials'],
    [{ code: 'email_not_confirmed' }, 'email_not_confirmed'],
    [{ code: 'over_email_send_rate_limit' }, 'rate_limited'],
    [{ status: 429, message: 'x' }, 'rate_limited'],
    [{ code: 'weak_password' }, 'weak_password'],
    [{ code: 'same_password' }, 'same_password'],
    [{ code: 'user_already_exists' }, 'user_already_exists'],
    [{ code: 'session_not_found' }, 'session_expired'],
    [{ name: 'AuthSessionMissingError' }, 'session_expired'],
    [{ status: 401 }, 'session_expired'],
    [{ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }, 'network_error'],
    [{ message: 'backend_not_configured' }, 'backend_not_configured'],
    [{ code: 'something_new', message: 'database exploded at host 10.0.0.5' }, 'unknown'],
  ];
  it.each(cases)('maps %j to %s', (input, expected) => {
    const mapped = mapAuthError(input);
    expect(mapped.error).toBe(expected);
    expect(mapped.message).toBe(MESSAGES[expected]);
  });

  it('never repeats raw server text', () => {
    expect(mapAuthError({ code: 'x', message: 'User with email a@b.co not found in table users' }).message).toBe(MESSAGES.unknown);
  });

  it('does not tell "no such user" apart from "wrong password"', () => {
    expect(mapAuthError({ code: 'user_not_found' }).message).toBe(mapAuthError({ code: 'invalid_credentials' }).message);
  });
});

describe('toUser', () => {
  it('keeps only id, email and full name', () => {
    expect(toUser({ id: 'u', email: 'a@b.co', user_metadata: { full_name: 'Ada' }, app_metadata: { role: 'x' }, access_token: 't' })).toEqual({ id: 'u', email: 'a@b.co', fullName: 'Ada' });
    expect(toUser(null)).toBeNull();
  });
});

describe('demo mode (no Supabase client)', () => {
  it('answers backend_not_configured for every action and reports signed-out', async () => {
    const auth = useAuth.getState();
    await auth.init();
    expect(useAuth.getState().status).toBe('signed-out');
    for (const result of [
      await auth.signIn('a@b.co', 'Abcdefghi1'), await auth.signUp('a@b.co', 'Abcdefghi1', 'Ada'), await auth.requestPasswordReset('a@b.co'),
      await auth.updatePassword('Abcdefghi1'), await auth.changePassword('x', 'Abcdefghi1'),
    ]) {
      expect(result).toMatchObject({ ok: false, error: 'backend_not_configured' });
      expect(result.message).toBeTruthy();
    }
    expect(await auth.signOut()).toEqual({ ok: true });
  });
});

describe('with a Supabase client', () => {
  it('init is idempotent and exposes the stored session', async () => {
    const client = fakeClient({ getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1', email: 'a@b.co' } } } })) });
    mocks.client = client;
    await Promise.all([useAuth.getState().init(), useAuth.getState().init()]);
    await useAuth.getState().init();
    expect(client.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(client.auth.getSession).toHaveBeenCalledTimes(1);
    expect(useAuth.getState()).toMatchObject({ status: 'signed-in', user: { id: 'u1', email: 'a@b.co' } });
  });

  it('follows auth events and flags PASSWORD_RECOVERY', async () => {
    const client = fakeClient();
    mocks.client = client;
    await useAuth.getState().init();
    expect(useAuth.getState().status).toBe('signed-out');
    client.emit('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'a@b.co' } });
    expect(useAuth.getState()).toMatchObject({ status: 'signed-in', recovery: true });
    client.emit('SIGNED_OUT', null);
    expect(useAuth.getState()).toMatchObject({ status: 'signed-out', user: null, recovery: false });
  });

  it('signIn validates early, calls Supabase and maps errors', async () => {
    const client = fakeClient();
    mocks.client = client;
    expect(await useAuth.getState().signIn('bad', '')).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(await useAuth.getState().signIn(' a@b.co ', 'whatever')).toEqual({ ok: true });
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'whatever' });
    expect(useAuth.getState()).toMatchObject({ status: 'signed-in', user: { fullName: 'Ada' } });

    client.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } });
    expect(await useAuth.getState().signIn('a@b.co', 'wrong')).toMatchObject({ ok: false, error: 'invalid_credentials', message: MESSAGES.invalid_credentials });
    client.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await useAuth.getState().signIn('a@b.co', 'x')).toMatchObject({ ok: false, error: 'network_error' });
  });

  it('signUp is neutral: an existing address looks the same as a new one', async () => {
    const client = fakeClient();
    mocks.client = client;
    expect(await useAuth.getState().signUp('a@b.co', 'Abcdefghi1', ' Ada ')).toEqual({ ok: true, neutral: true });
    expect(client.auth.signUp).toHaveBeenCalledWith({ email: 'a@b.co', password: 'Abcdefghi1', options: { data: { full_name: 'Ada' } } });
    client.auth.signUp.mockResolvedValueOnce({ data: {}, error: { code: 'user_already_exists', status: 422, message: 'User already registered' } });
    expect(await useAuth.getState().signUp('a@b.co', 'Abcdefghi1', 'Ada')).toEqual({ ok: true, neutral: true });
    client.auth.signUp.mockResolvedValueOnce({ data: {}, error: { code: 'over_email_send_rate_limit', status: 429 } });
    expect(await useAuth.getState().signUp('a@b.co', 'Abcdefghi1', 'Ada')).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(await useAuth.getState().signUp('a@b.co', 'weak', 'Ada')).toMatchObject({ ok: false, error: 'invalid_input' });
  });

  it('requestPasswordReset uses the reset route and hides whether the account exists', async () => {
    const client = fakeClient();
    mocks.client = client;
    expect(await useAuth.getState().requestPasswordReset('a@b.co')).toEqual({ ok: true, neutral: true });
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', { redirectTo: 'https://shop.example/account/reset-password' });
    client.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: { code: 'user_not_found', status: 400 } });
    expect(await useAuth.getState().requestPasswordReset('nobody@b.co')).toEqual({ ok: true, neutral: true });
    client.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: { code: 'over_email_send_rate_limit', status: 429 } });
    expect(await useAuth.getState().requestPasswordReset('a@b.co')).toMatchObject({ ok: false, error: 'rate_limited' });
  });

  it('updatePassword checks the rules first, then clears the recovery flag', async () => {
    const client = fakeClient();
    mocks.client = client;
    useAuth.setState({ recovery: true });
    expect(await useAuth.getState().updatePassword('short')).toMatchObject({ ok: false, error: 'weak_password' });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
    expect(await useAuth.getState().updatePassword('Abcdefghi1')).toEqual({ ok: true });
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: 'Abcdefghi1' });
    expect(useAuth.getState().recovery).toBe(false);
    client.auth.updateUser.mockResolvedValueOnce({ data: null, error: { code: 'same_password', status: 422 } });
    expect(await useAuth.getState().updatePassword('Abcdefghi1')).toMatchObject({ ok: false, error: 'same_password' });
  });

  it('changePassword verifies the current password before changing it', async () => {
    const client = fakeClient();
    mocks.client = client;
    useAuth.setState({ status: 'signed-in', user: { id: 'u1', email: 'a@b.co', fullName: '' } });
    client.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { code: 'invalid_credentials', status: 400 } });
    expect(await useAuth.getState().changePassword('wrong', 'Abcdefghi1')).toMatchObject({ ok: false, message: 'Your current password is not correct.' });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
    expect(await useAuth.getState().changePassword('Current123x', 'Abcdefghi1')).toEqual({ ok: true });
    expect(client.auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it('signOut clears the local state even when the server call fails', async () => {
    const client = fakeClient({ signOut: vi.fn(async () => { throw new Error('offline'); }) });
    mocks.client = client;
    useAuth.setState({ status: 'signed-in', user: { id: 'u1', email: 'a@b.co', fullName: '' } });
    expect(await useAuth.getState().signOut()).toEqual({ ok: true });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useAuth.getState()).toMatchObject({ status: 'signed-out', user: null });
  });
});
