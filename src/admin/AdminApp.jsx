/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Owner/staff admin area, mounted at /admin/* and lazy-loaded so the storefront bundle does not carry it.
//
// Access is decided by the server. After sign-in (and the two-step challenge when a factor is enrolled) the app asks
// the database `is_admin()`. Only a `true` answer shows anything. Every later read and write is checked again by
// row-level security and the admin_* functions, and a `forbidden` answer from any of them returns to "Access denied".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import './admin.css';
import { isBackend } from '../lib/config.js';
import { supabase as realSupabase } from '../lib/supabase.js';
import { callFunction } from '../lib/api.js';
import { useScrollLock } from '../lib/scrollLock.js';
import { createGateway } from './api.js';
import { AdminContext, useAdmin } from './hooks.js';
import { AccessDenied, AdminUnavailable, CheckingAccess, MfaChallenge, MfaEnroll, SessionProblem, SignIn } from './Auth.jsx';
import { Badge, Button, Card, PageHeader } from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { ProductEditor, ProductsList } from './pages/Products.jsx';
import Inventory from './pages/Inventory.jsx';
import { OrderDetail, OrdersList } from './pages/Orders.jsx';
import Messages from './pages/Messages.jsx';
import Newsletter from './pages/Newsletter.jsx';
import Settings from './pages/Settings.jsx';
import Policies from './pages/Policies.jsx';
import Operations from './pages/Operations.jsx';
import Exports from './pages/Exports.jsx';

const NAV = [
  ['', 'Dashboard', true], ['products', 'Products'], ['inventory', 'Inventory'], ['orders', 'Orders'], ['messages', 'Messages'],
  ['newsletter', 'Newsletter'], ['settings', 'Settings'], ['policies', 'Policies'], ['operations', 'Operations'], ['exports', 'Exports'], ['security', 'Security'],
];

/** Draws the admin above the storefront chrome (header, footer) and keeps the page behind from scrolling. */
function Layer({ children }) {
  useScrollLock(true, 'admin-area');
  useEffect(() => {
    const previousTitle = document.title;
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    document.title = 'Admin | OLDVERGE';
    return () => { robots.remove(); document.title = previousTitle; };
  }, []);
  const layer = <div className="ovad" data-lenis-prevent>{children}</div>;
  return typeof document === 'undefined' ? layer : createPortal(layer, document.body);
}

function SecurityPage({ supabase }) {
  const { refresh } = useAdmin();
  return (
    <>
      <PageHeader title="Security" lead="Two-step sign-in adds a 6-digit code from your phone to your password." />
      <Card title="Two-step sign-in (authenticator app)">
        <MfaEnroll supabase={supabase} embedded onDone={refresh} />
      </Card>
      <Card title="What this does and does not do">
        <p>
          Turning on two-step sign-in makes this browser ask for a code after your password. Whether the store <em>requires</em> it for every
          admin is a server setting (<code>require_mfa</code>) that the project owner controls in the database, not something this page can switch.
        </p>
      </Card>
    </>
  );
}

function NotFound() {
  return <><PageHeader title="Page not found" /><p>There is no such admin page.</p></>;
}

function Shell({ supabase, user, role, hasMfa, onSignOut }) {
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);
  return (
    <>
      <a className="ovad-skip" href="#ovad-main" onClick={(event) => { event.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a>
      <header className="ovad-topbar">
        <div className="ovad-topbar-inner">
          <span className="ovad-wordmark">OLDVERGE <span>Admin</span></span>
          <div className="ovad-user">
            <span className="ovad-user-email">{user.email}</span>
            <Badge tone={role === 'owner' ? 'ok' : 'neutral'}>{role || 'admin'}</Badge>
            <a className="ovad-link" href="/">View storefront</a>
            <Button onClick={onSignOut}>Sign out</Button>
          </div>
        </div>
        <nav className="ovad-nav" aria-label="Admin sections">
          <ul>
            {NAV.map(([path, label, end]) => (
              <li key={path || 'home'}><NavLink to={`/admin/${path}`} end={Boolean(end)}>{label}</NavLink></li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="ovad-main" className="ovad-main" ref={mainRef} tabIndex={-1}>
        {!hasMfa ? (
          <p className="ovad-banner">Two-step sign-in is off for your account. <NavLink to="/admin/security">Turn it on</NavLink> to protect the store.</p>
        ) : null}
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="products" element={<ProductsList />} />
          <Route path="products/:id" element={<ProductEditor />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="orders" element={<OrdersList />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="messages" element={<Messages />} />
          <Route path="newsletter" element={<Newsletter />} />
          <Route path="settings" element={<Settings />} />
          <Route path="policies" element={<Policies />} />
          <Route path="operations" element={<Operations />} />
          <Route path="exports" element={<Exports />} />
          <Route path="security" element={<SecurityPage supabase={supabase} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}

/**
 * phase: loading | signed_out | mfa | enroll | checking | denied | problem | ready
 * `supabase` and `functions` can be injected (tests); they default to the app's real client.
 */
export function AdminGate({ supabase, functions = callFunction }) {
  const [phase, setPhase] = useState('loading');
  const [session, setSession] = useState({ user: null, role: null, hasMfa: false, problem: '' });
  const phaseRef = useRef(phase);
  const userIdRef = useRef(null);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  /** Asks the server who this is. `quiet` re-checks without hiding the page the person is on. */
  const evaluate = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setPhase('checking');
    try {
      const { data } = await supabase.auth.getSession();
      const current = data?.session;
      if (!current) { userIdRef.current = null; setPhase('signed_out'); return; }
      userIdRef.current = current.user.id;
      const user = { id: current.user.id, email: current.user.email || '' };
      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const factorEnrolled = level?.nextLevel === 'aal2';
      if (factorEnrolled && level.currentLevel !== 'aal2') { setSession((s) => ({ ...s, user, hasMfa: true })); setPhase('mfa'); return; }
      const { data: isAdmin, error } = await supabase.rpc('is_admin');
      if (error) { setSession((s) => ({ ...s, user, problem: 'The server could not confirm your access. Try again in a moment.' })); setPhase('problem'); return; }
      if (isAdmin !== true) { setSession({ user, role: null, hasMfa: factorEnrolled, problem: '' }); setPhase('denied'); return; }
      const { data: role } = await supabase.rpc('admin_role');
      setSession({ user, role: typeof role === 'string' ? role : null, hasMfa: factorEnrolled, problem: '' });
      setPhase('ready');
    } catch {
      setSession((s) => ({ ...s, problem: 'Could not reach the server. Check your connection and try again.' }));
      setPhase('problem');
    }
  }, [supabase]);

  useEffect(() => {
    evaluate();
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // No awaiting inside this callback (the auth client would deadlock). Defer the follow-up work.
      if (event === 'SIGNED_OUT') { userIdRef.current = null; setTimeout(() => setPhase('signed_out'), 0); return; }
      if (event === 'SIGNED_IN' && next?.user && (next.user.id !== userIdRef.current || phaseRef.current === 'signed_out')) setTimeout(() => evaluate(), 0);
    });
    return () => data?.subscription?.unsubscribe();
  }, [supabase, evaluate]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession({ user: null, role: null, hasMfa: false, problem: '' });
    setPhase('signed_out');
  }, [supabase]);

  // Any data call that fails with "forbidden", or with a failure that may mean access changed, lands here.
  const onProblem = useCallback(async (error) => {
    if (error.forbidden) { setPhase('denied'); return; }
    try {
      const { data } = await supabase.auth.getSession();
      if (!data?.session) { setPhase('signed_out'); return; }
      const { data: isAdmin, error: failure } = await supabase.rpc('is_admin');
      if (!failure && isAdmin !== true) setPhase('denied');
    } catch { /* the original error is already shown where it happened */ }
  }, [supabase]);

  const gateway = useMemo(() => createGateway({ client: supabase, callFunction: functions, onProblem }), [supabase, functions, onProblem]);
  const refresh = useCallback(() => evaluate({ quiet: true }), [evaluate]);
  const context = useMemo(() => ({ gateway, role: session.role, email: session.user?.email || '', signOut, refresh }), [gateway, session.role, session.user, signOut, refresh]);

  if (phase === 'loading' || phase === 'checking') return <CheckingAccess />;
  if (phase === 'signed_out') return <SignIn supabase={supabase} />;
  if (phase === 'mfa') return <MfaChallenge supabase={supabase} onVerified={() => evaluate()} onSignOut={signOut} />;
  if (phase === 'enroll') return <MfaEnroll supabase={supabase} onDone={() => evaluate()} onCancel={() => evaluate()} />;
  if (phase === 'problem') return <SessionProblem message={session.problem} onRetry={() => evaluate()} onSignOut={signOut} />;
  if (phase === 'denied') return <AccessDenied email={session.user?.email} onSignOut={signOut} onSetupMfa={() => setPhase('enroll')} />;
  return (
    <AdminContext.Provider value={context}>
      <Shell supabase={supabase} user={session.user} role={session.role} hasMfa={session.hasMfa} onSignOut={signOut} />
    </AdminContext.Provider>
  );
}

export default function AdminApp() {
  return (
    <Layer>
      {isBackend && realSupabase ? <AdminGate supabase={realSupabase} /> : <AdminUnavailable />}
    </Layer>
  );
}
