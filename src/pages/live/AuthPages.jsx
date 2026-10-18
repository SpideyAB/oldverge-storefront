import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PASSWORD_MIN_LENGTH, useAuth, validateEmail, validatePassword } from '../../lib/auth.js';
import { Field, PasswordField } from '../../components/ui.jsx';
import { safeNext } from './helpers.js';
import { AuthShell, ErrorSummary, FormMessage, useForm } from './shared.jsx';

const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters, with an upper case letter, a lower case letter and a number.`;

function useAuthInit() {
  const init = useAuth((state) => state.init);
  const status = useAuth((state) => state.status);
  useEffect(() => { init(); }, [init]);
  return status;
}

export function LoginPage() {
  const status = useAuthInit();
  const signIn = useAuth((state) => state.signIn);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const form = useForm({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const next = safeNext(params.get('next'));

  if (status === 'signed-in') return <Navigate to={next} replace />;

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setProblem('');
    const found = { email: validateEmail(form.values.email), password: form.values.password ? null : 'Enter your password.' };
    if (form.fail(found)) return;
    setBusy(true);
    const result = await signIn(form.values.email, form.values.password);
    setBusy(false);
    if (result.ok) { navigate(next, { replace: true }); return; }
    setProblem(result.message);
  };

  return <AuthShell title="Sign in">
    <form onSubmit={submit} noValidate className="ov-form" aria-busy={busy}>
      <ErrorSummary errors={form.errors} />
      <Field label="Email" type="email" autoComplete="email" {...form.bind('email')} />
      <PasswordField autoComplete="current-password" {...form.bind('password')} />
      <FormMessage>{problem}</FormMessage>
      <button type="submit" className="ov-button ov-button-dark" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <p className="ov-auth-links"><Link to="/account/forgot-password">Forgot your password?</Link><span>New here? <Link to="/account/register">Create an account</Link></span></p>
    <p className="ov-note">Placed an order as a guest? <Link to="/pages/track-order" className="ov-text-link">Track an order</Link> with its order number and access code. Guest orders are not linked to an account automatically.</p>
  </AuthShell>;
}

export function RegisterPage() {
  const status = useAuthInit();
  const signUp = useAuth((state) => state.signUp);
  const form = useForm({ full_name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState(false);

  if (status === 'signed-in') return <Navigate to="/account" replace />;

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setProblem('');
    const name = form.values.full_name.trim();
    const found = {
      full_name: !name ? 'Enter your name.' : name.length > 80 ? 'Use 80 characters or fewer.' : null,
      email: validateEmail(form.values.email),
      password: validatePassword(form.values.password),
    };
    if (form.fail(found)) return;
    setBusy(true);
    const result = await signUp(form.values.email, form.values.password, name);
    setBusy(false);
    if (result.ok) { form.setValues((current) => ({ ...current, password: '' })); setDone(true); return; }
    setProblem(result.message);
  };

  return <AuthShell title="Create account">
    {done
      ? <div className="ov-form-done" role="status">
        <h2>Check your email</h2>
        <p>If this address can be registered, you will receive a confirmation email. Follow the link in it before you sign in.</p>
        <Link to="/account/login" className="ov-button ov-button-dark">Go to sign in</Link>
      </div>
      : <form onSubmit={submit} noValidate className="ov-form" aria-busy={busy}>
        <ErrorSummary errors={form.errors} />
        <Field label="Full name" autoComplete="name" {...form.bind('full_name')} />
        <Field label="Email" type="email" autoComplete="email" {...form.bind('email')} />
        <PasswordField autoComplete="new-password" hint={PASSWORD_HINT} {...form.bind('password')} />
        <FormMessage>{problem}</FormMessage>
        <button type="submit" className="ov-button ov-button-dark" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        <p className="ov-note">Orders you placed earlier as a guest are not linked to a new account automatically.</p>
      </form>}
    <p className="ov-auth-links"><span>Already have an account? <Link to="/account/login">Sign in</Link></span></p>
  </AuthShell>;
}

export function ForgotPasswordPage() {
  useAuthInit();
  const requestPasswordReset = useAuth((state) => state.requestPasswordReset);
  const form = useForm({ email: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setProblem('');
    if (form.fail({ email: validateEmail(form.values.email) })) return;
    setBusy(true);
    const result = await requestPasswordReset(form.values.email);
    setBusy(false);
    if (result.ok) setDone(true); else setProblem(result.message);
  };

  return <AuthShell title="Reset your password">
    {done
      ? <div className="ov-form-done" role="status">
        <h2>Check your email</h2>
        <p>If an account exists for this address, we will send instructions for choosing a new password.</p>
        <Link to="/account/login" className="ov-button ov-button-dark">Back to sign in</Link>
      </div>
      : <form onSubmit={submit} noValidate className="ov-form" aria-busy={busy}>
        <ErrorSummary errors={form.errors} />
        <Field label="Email" type="email" autoComplete="email" {...form.bind('email')} />
        <FormMessage>{problem}</FormMessage>
        <button type="submit" className="ov-button ov-button-dark" disabled={busy}>{busy ? 'Sending…' : 'Send reset instructions'}</button>
      </form>}
    <p className="ov-auth-links"><Link to="/account/login">Back to sign in</Link></p>
  </AuthShell>;
}

/** Supabase puts errors for a bad or used link in the query string or the hash fragment. */
function linkError(location) {
  const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  const query = new URLSearchParams(location.search || '');
  return Boolean(hash.get('error') || hash.get('error_code') || query.get('error') || query.get('error_code'));
}

export function ResetPasswordPage() {
  const status = useAuthInit();
  const recovery = useAuth((state) => state.recovery);
  const updatePassword = useAuth((state) => state.updatePassword);
  const location = useLocation();
  const form = useForm({ password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState(false);

  // The recovery link signs the visitor in with a short-lived session; without one there is nothing to reset.
  const usable = !linkError(location) && (recovery || status === 'signed-in');

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setProblem('');
    const found = {
      password: validatePassword(form.values.password),
      confirm: form.values.confirm !== form.values.password ? 'The two passwords do not match.' : null,
    };
    if (form.fail(found)) return;
    setBusy(true);
    const result = await updatePassword(form.values.password);
    setBusy(false);
    if (result.ok) { form.setValues({ password: '', confirm: '' }); setDone(true); return; }
    setProblem(result.message);
  };

  if (status === 'loading') return <AuthShell title="Choose a new password"><p className="ov-note" role="status" aria-busy="true">Checking your reset link…</p></AuthShell>;
  if (done) {
    return <AuthShell title="Password updated">
      <div className="ov-form-done" role="status">
        <h2>Your password has been changed</h2>
        <p>Use your new password the next time you sign in.</p>
        <Link to="/account" className="ov-button ov-button-dark">Go to your account</Link>
      </div>
    </AuthShell>;
  }
  if (!usable) {
    return <AuthShell title="Reset link not valid">
      <div className="ov-empty" role="alert">
        <h2>This link is not valid or has expired</h2>
        <p>Reset links can be used once and stop working after a short time. Request a new one to continue.</p>
        <div className="ov-empty-actions"><Link to="/account/forgot-password" className="ov-button ov-button-dark">Request a new link</Link></div>
      </div>
    </AuthShell>;
  }
  return <AuthShell title="Choose a new password">
    <form onSubmit={submit} noValidate className="ov-form" aria-busy={busy}>
      <ErrorSummary errors={form.errors} />
      <PasswordField label="New password" autoComplete="new-password" hint={PASSWORD_HINT} {...form.bind('password')} />
      <PasswordField label="Confirm new password" autoComplete="new-password" {...form.bind('confirm')} />
      <FormMessage>{problem}</FormMessage>
      <button type="submit" className="ov-button ov-button-dark" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
    </form>
  </AuthShell>;
}
