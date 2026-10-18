/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Server-renders the admin screens that do not need a live backend, to prove they do not throw:
// demo mode, access denied, the access check, and every page's first (loading) render with a mocked gateway.
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const mode = vi.hoisted(() => ({ backend: false }));

vi.mock('../lib/config.js', () => ({
  get isBackend() { return mode.backend; },
  backend: { configured: false, mode: 'demo' },
}));

const fakeSupabase = vi.hoisted(() => ({
  auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({}),
    mfa: {},
  },
  rpc: async () => ({ data: null, error: null }),
  from: () => ({}),
}));

vi.mock('../lib/supabase.js', () => ({
  get supabase() { return mode.backend ? fakeSupabase : null; },
  requireSupabase: () => fakeSupabase,
}));

import AdminApp, { AdminGate } from './AdminApp.jsx';
import { AccessDenied, AdminUnavailable, MfaChallenge, SessionProblem, SignIn } from './Auth.jsx';
import { AdminContext } from './hooks.js';
import { createGateway } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Exports from './pages/Exports.jsx';
import Inventory from './pages/Inventory.jsx';
import Messages from './pages/Messages.jsx';
import Newsletter from './pages/Newsletter.jsx';
import Operations from './pages/Operations.jsx';
import { OrderDetail, OrdersList } from './pages/Orders.jsx';
import Policies from './pages/Policies.jsx';
import { ProductEditor, ProductsList } from './pages/Products.jsx';
import Settings from './pages/Settings.jsx';

describe('admin smoke render', () => {
  it('shows a clear page in demo mode and no data', () => {
    mode.backend = false;
    const html = renderToString(<MemoryRouter initialEntries={['/admin']}><AdminApp /></MemoryRouter>);
    expect(html).toContain('Admin needs the Supabase backend');
    expect(html).not.toContain('Sign in');
  });

  it('renders the unavailable page directly', () => {
    expect(renderToString(<AdminUnavailable />)).toContain('demo mode');
  });

  it('renders access denied without any store data', () => {
    const html = renderToString(<AccessDenied email="someone@example.com" onSignOut={() => {}} onSetupMfa={() => {}} />);
    expect(html).toContain('Access denied');
    expect(html).toContain('someone@example.com');
    expect(html).toContain('No store data has been loaded');
  });

  it('renders the other pre-access screens', () => {
    expect(renderToString(<SignIn supabase={fakeSupabase} />)).toContain('Admin sign in');
    expect(renderToString(<MfaChallenge supabase={fakeSupabase} onVerified={() => {}} onSignOut={() => {}} />)).toContain('Two-step sign in');
    expect(renderToString(<SessionProblem message="x" onRetry={() => {}} onSignOut={() => {}} />)).toContain('Could not check your access');
  });

  it('starts at the access check in backend mode and loads nothing before the server answers', () => {
    mode.backend = true;
    const html = renderToString(<MemoryRouter initialEntries={['/admin']}><AdminApp /></MemoryRouter>);
    expect(html).toContain('Checking your access');
    expect(html).not.toContain('Dashboard');
    const gate = renderToString(<AdminGate supabase={fakeSupabase} functions={async () => ({ ok: true, status: 200, data: {} })} />);
    expect(gate).toContain('Checking your access');
    mode.backend = false;
  });

  it('renders every page in its loading state', () => {
    const gateway = createGateway({
      client: { rpc: () => new Promise(() => {}), from: () => ({}) },
      callFunction: async () => ({ ok: true, status: 200, data: {} }),
    });
    const context = { gateway, role: 'owner', email: 'owner@example.com', signOut() {}, refresh() {} };
    const pages = { Dashboard, ProductsList, ProductEditor, Inventory, OrdersList, OrderDetail, Messages, Newsletter, Settings, Policies, Operations, Exports };
    for (const [name, Page] of Object.entries(pages)) {
      const html = renderToString(
        <MemoryRouter initialEntries={['/admin']}>
          <AdminContext.Provider value={context}><Page /></AdminContext.Provider>
        </MemoryRouter>,
      );
      expect(html.length, name).toBeGreaterThan(50);
    }
  });
});
