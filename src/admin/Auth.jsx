/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Sign-in, password reset request, two-factor challenge and enrolment, and the access-denied / unavailable screens.
// None of these load store data. Whether the person is an admin is decided by the server (is_admin), never here.
import { useCallback, useEffect, useState } from 'react';
import { Button, NoticeSlot, Spinner, TextInput } from './ui.jsx';
import { useNotice } from './hooks.js';

export function AuthFrame({ title, lead, children, wide = false }) {
  return (
    <main className={`ovad-auth${wide ? ' ovad-auth-wide' : ''}`} id="ovad-main">
      <div className="ovad-auth-card">
        <p className="ovad-wordmark">OLDVERGE <span>Admin</span></p>
        <h1>{title}</h1>
        {lead ? <p className="ovad-lead">{lead}</p> : null}
        {children}
      </div>
    </main>
  );
}

/** Shown when the storefront runs without a Supabase project (demo mode). */
export function AdminUnavailable() {
  return (
    <AuthFrame title="Admin needs the Supabase backend" lead="The store is running in demo mode, so there is nothing to administer here.">
      <p>
        The admin area edits real products, stock and orders, and it only works when the site is connected to its Supabase project
        (<code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>). Nothing is shown or saved in demo mode.
      </p>
      <p><a className="ovad-link" href="/">Back to the storefront</a></p>
    </AuthFrame>
  );
}

export function AccessDenied({ email, onSignOut, onSetupMfa, reason }) {
  return (
    <AuthFrame title="Access denied" lead={email ? `${email} is not an admin of this store.` : 'This account is not an admin of this store.'}>
      <p>No store data has been loaded. {reason || 'If you should have access, ask the store owner to add you.'}</p>
      <p>If the store requires two-step sign-in for admins, you may need to set it up and sign in again.</p>
      <div className="ovad-row">
        {onSetupMfa ? <Button onClick={onSetupMfa}>Set up two-step sign-in</Button> : null}
        {onSignOut ? <Button tone="primary" onClick={onSignOut}>Sign out</Button> : null}
        <a className="ovad-link" href="/">Back to the storefront</a>
      </div>
    </AuthFrame>
  );
}

export function CheckingAccess({ label = 'Checking your access' }) {
  return (
    <AuthFrame title="One moment">
      <Spinner label={label} />
    </AuthFrame>
  );
}

export function SessionProblem({ message, onRetry, onSignOut }) {
  return (
    <AuthFrame title="Could not check your access" lead="The server did not confirm who you are, so nothing is shown.">
      <p role="alert" className="ovad-notice ovad-notice-error">{message}</p>
      <div className="ovad-row">
        <Button tone="primary" onClick={onRetry}>Try again</Button>
        <Button onClick={onSignOut}>Sign out</Button>
      </div>
    </AuthFrame>
  );
}

export function SignIn({ supabase }) {
  const notice = useNotice();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('signin');

  const submit = async (event) => {
    event.preventDefault();
    notice.clear();
    setBusy(true);
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/account/reset-password` });
        // The same answer for every address, so the form cannot be used to discover who has an account.
        if (error && /rate|too many/i.test(error.message || '')) notice.fail(new Error('Too many requests. Wait a few minutes and try again.'));
        else notice.ok('If that address has an account, a reset link is on its way. Check your inbox.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) notice.fail(new Error(/rate|too many/i.test(error.message || '') ? 'Too many attempts. Wait a few minutes and try again.' : 'The email or password is not correct.'));
        else setPassword('');
      }
    } catch {
      notice.fail(new Error('Could not reach the server. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title={mode === 'reset' ? 'Reset your password' : 'Admin sign in'} lead={mode === 'reset' ? 'Enter your email and we will send a reset link.' : 'For the store owner and staff only.'}>
      <form onSubmit={submit} className="ovad-form" noValidate={false}>
        <TextInput label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" required wide />
        {mode === 'signin' ? <TextInput label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required wide /> : null}
        <NoticeSlot notice={notice.notice} />
        <div className="ovad-row">
          <Button type="submit" tone="primary" busy={busy}>{mode === 'reset' ? 'Send reset link' : 'Sign in'}</Button>
          <button type="button" className="ovad-linkbutton" onClick={() => { notice.clear(); setMode(mode === 'reset' ? 'signin' : 'reset'); }}>
            {mode === 'reset' ? 'Back to sign in' : 'Forgot password?'}
          </button>
        </div>
      </form>
    </AuthFrame>
  );
}

const CODE_PATTERN = /^\d{6}$/;

export function MfaChallenge({ supabase, onVerified, onSignOut }) {
  const notice = useNotice();
  const [factors, setFactors] = useState(null);
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!live) return;
      if (error) { notice.fail(new Error('Could not load your two-step sign-in methods.')); setFactors([]); return; }
      const totp = (data?.totp || []).filter((factor) => factor.status === 'verified');
      setFactors(totp);
      if (totp[0]) setFactorId(totp[0].id);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const submit = async (event) => {
    event.preventDefault();
    if (!CODE_PATTERN.test(code)) { notice.fail(new Error('Enter the 6-digit code from your authenticator app.')); return; }
    setBusy(true);
    notice.clear();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (error) { notice.fail(new Error('That code was not accepted. Wait for a new code and try again.')); setCode(''); return; }
    onVerified();
  };

  return (
    <AuthFrame title="Two-step sign in" lead="Enter the 6-digit code from your authenticator app.">
      {factors === null ? <Spinner label="Loading" /> : factors.length === 0 ? (
        <p role="alert" className="ovad-notice ovad-notice-error">No verified authenticator is set up for this account.</p>
      ) : (
        <form onSubmit={submit} className="ovad-form">
          <TextInput label="6-digit code" value={code} onChange={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required autoFocus />
          <NoticeSlot notice={notice.notice} />
          <div className="ovad-row">
            <Button type="submit" tone="primary" busy={busy}>Verify</Button>
            <Button onClick={onSignOut}>Sign out</Button>
          </div>
        </form>
      )}
      {factors && factors.length === 0 ? <div className="ovad-row"><Button onClick={onSignOut}>Sign out</Button></div> : null}
    </AuthFrame>
  );
}

/** Enrols a TOTP authenticator (QR code or typed secret), then verifies the first code. */
export function MfaEnroll({ supabase, onDone, onCancel, embedded = false }) {
  const notice = useNotice();
  const [factor, setFactor] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState(null);

  const loadExisting = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setExisting((data?.totp || []).filter((item) => item.status === 'verified'));
  }, [supabase]);
  useEffect(() => { loadExisting(); }, [loadExisting]);

  const start = async () => {
    setBusy(true);
    notice.clear();
    // Clear an abandoned, unverified attempt first so the friendly name is free.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const stale of (list?.all || []).filter((item) => item.factor_type === 'totp' && item.status === 'unverified')) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `OLDVERGE admin ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (error || !data) { notice.fail(new Error('Could not start two-step setup. You may need to sign in again.')); return; }
    setFactor(data);
  };

  const verify = async (event) => {
    event.preventDefault();
    if (!factor) return;
    if (!CODE_PATTERN.test(code)) { notice.fail(new Error('Enter the 6-digit code shown in your authenticator app.')); return; }
    setBusy(true);
    notice.clear();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setBusy(false);
    if (error) { notice.fail(new Error('That code was not accepted. Wait for a new code and try again.')); setCode(''); return; }
    setFactor(null);
    setCode('');
    notice.ok('Two-step sign-in is now on for your account.');
    loadExisting();
    onDone?.();
  };

  const cancel = async () => {
    if (factor) await supabase.auth.mfa.unenroll({ factorId: factor.id });
    setFactor(null);
    setCode('');
    onCancel?.();
  };

  const body = (
    <>
      {existing && existing.length > 0 && !factor ? (
        <p className="ovad-notice ovad-notice-ok" role="status">Two-step sign-in is already set up ({existing.length} authenticator{existing.length === 1 ? '' : 's'}).</p>
      ) : null}
      {!factor ? (
        <>
          <p>Use an authenticator app (for example Google Authenticator, Microsoft Authenticator or 1Password). You will scan a code once and enter a 6-digit code each time you sign in.</p>
          <div className="ovad-row">
            <Button tone="primary" busy={busy} onClick={start}>{existing && existing.length ? 'Add another authenticator' : 'Start setup'}</Button>
            {onCancel ? <Button onClick={cancel}>Back</Button> : null}
          </div>
        </>
      ) : (
        <form onSubmit={verify} className="ovad-form">
          <ol className="ovad-steps">
            <li>Scan this code with your authenticator app.</li>
            <li>If you cannot scan, type this key into the app instead.</li>
            <li>Enter the 6-digit code it shows.</li>
          </ol>
          <img className="ovad-qr" src={factor.totp.qr_code} alt="Two-step setup QR code" width="180" height="180" />
          <p>Key: <code className="ovad-secret">{factor.totp.secret}</code></p>
          <TextInput label="6-digit code" value={code} onChange={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required />
          <div className="ovad-row">
            <Button type="submit" tone="primary" busy={busy}>Verify and turn on</Button>
            <Button onClick={cancel}>Cancel</Button>
          </div>
        </form>
      )}
      <NoticeSlot notice={notice.notice} />
    </>
  );
  if (embedded) return body;
  return <AuthFrame title="Set up two-step sign-in" wide>{body}</AuthFrame>;
}
