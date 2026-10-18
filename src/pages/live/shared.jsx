import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PageHead } from '../../components/ui.jsx';
import { loginPath } from './helpers.js';

/** Form state with per-field errors; `fail` records them and moves focus to the first invalid field. */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const bind = (name) => ({
    name,
    value: values[name],
    error: errors[name],
    onChange: (event) => {
      const { value } = event.target;
      setValues((current) => ({ ...current, [name]: value }));
      setErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
    },
  });
  const fail = (found) => {
    const clean = Object.fromEntries(Object.entries(found).filter(([, message]) => message));
    setErrors(clean);
    const first = Object.keys(clean)[0];
    if (first) window.setTimeout(() => document.querySelector(`[name="${first}"]`)?.focus(), 0);
    return Object.keys(clean).length > 0;
  };
  return { values, setValues, errors, setErrors, bind, fail };
}

/** Lists every problem found in a submitted form. The first invalid field also receives focus (see useForm.fail). */
export function ErrorSummary({ errors }) {
  const messages = Object.values(errors || {}).filter(Boolean);
  if (!messages.length) return null;
  return <div className="ov-error-summary" role="alert">
    <h2>{messages.length === 1 ? 'There is a problem' : 'There are problems'}</h2>
    <ul>{messages.map((message) => <li key={message}>{message}</li>)}</ul>
  </div>;
}

/** Runs `load` when `key` changes (or retry is pressed) and exposes { status, data, error, retry }. */
export function useLoader(load, key) {
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((current) => (current.status === 'loading' ? current : { ...current, status: 'loading' }));
    Promise.resolve(loadRef.current()).then((result) => {
      if (cancelled) return;
      setState(result.ok ? { status: 'ready', data: result.data, error: null } : { status: 'error', data: null, error: result });
    });
    return () => { cancelled = true; };
  }, [key, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...state, retry };
}

/** When the server says the session is no longer valid: clear the local session and go to the sign-in page. */
export function SessionExpired() {
  const location = useLocation();
  const signOut = useAuth((state) => state.signOut);
  useEffect(() => { signOut(); }, [signOut]);
  return <Navigate to={loginPath(`${location.pathname}${location.search}`)} replace />;
}

/** Loading / error-with-retry / expired-session wrapper around data that comes from useLoader. */
export function LoadGate({ state, loadingText = 'Loading…', children }) {
  if (state.status === 'loading') return <p className="ov-note" role="status">{loadingText}</p>;
  if (state.status === 'error') {
    if (state.error?.error === 'expired') return <SessionExpired />;
    return <div className="ov-empty" role="alert">
      <h2>We could not load this</h2>
      <p>{state.error?.message || 'Something went wrong. Please try again.'}</p>
      {state.error?.error !== 'not_configured' && <div className="ov-empty-actions"><button type="button" className="ov-button ov-button-dark" onClick={state.retry}>Try again</button></div>}
    </div>;
  }
  return children(state.data);
}

const ACCOUNT_LINKS = [['/account', 'Dashboard', true], ['/account/orders', 'Orders'], ['/account/addresses', 'Addresses'], ['/account/profile', 'Profile']];

/** Signed-in shell for the account pages. Waits for the stored session, then redirects guests to the sign-in page. */
export function AccountLayout({ title, intro, children }) {
  const status = useAuth((state) => state.status);
  const init = useAuth((state) => state.init);
  const signOut = useAuth((state) => state.signOut);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { init(); }, [init]);
  if (status === 'signed-out') return <Navigate to={loginPath(`${location.pathname}${location.search}`)} replace />;
  if (status === 'loading') {
    return <main id="main-content" className="ov-page ov-account" aria-busy="true">
      <PageHead title={title} />
      <p className="ov-note" role="status">Loading your account…</p>
    </main>;
  }
  return <main id="main-content" className="ov-page ov-account">
    <PageHead title={title} intro={intro} />
    <div className="ov-account-layout">
      <nav className="ov-account-nav" aria-label="Account">
        {ACCOUNT_LINKS.map(([to, label, end]) => <NavLink key={to} to={to} end={end}>{label}</NavLink>)}
        <button type="button" className="ov-link-button" onClick={async () => { await signOut(); navigate('/'); }}>Sign out</button>
      </nav>
      <div className="ov-account-body">{children}</div>
    </div>
  </main>;
}

/** Page wrapper for the sign-in family of pages (guests). */
export function AuthShell({ title, intro, children }) {
  return <main id="main-content" className="ov-page ov-auth">
    <PageHead title={title} intro={intro} />
    {children}
  </main>;
}

/** Message block for the result of a submitted form: role=alert for problems, role=status for success. */
export function FormMessage({ tone = 'error', children }) {
  if (!children) return null;
  return tone === 'error'
    ? <p className="ov-form-error" role="alert">{children}</p>
    : <p className="ov-form-ok" role="status">{children}</p>;
}

/** Shown wherever orders are listed: guest orders are not attached to accounts automatically. */
export function GuestOrderNotice() {
  return <p className="ov-note">Orders placed as a guest are not linked to an account automatically. To see one, use <Link to="/pages/track-order" className="ov-text-link">Track an order</Link> with the order number and access code from its confirmation.</p>;
}
