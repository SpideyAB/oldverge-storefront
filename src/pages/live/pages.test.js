import * as React from 'react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Some shared components (src/components/ui.jsx) are compiled with the classic JSX transform in this test setup,
// which looks up a global `React`.
globalThis.React = React;

// Server rendering reads zustand's initial state, so the store is replaced by a plain mutable object here.
const auth = vi.hoisted(() => ({ state: {} }));
vi.mock('../../lib/auth.js', async (importActual) => ({ ...(await importActual()), useAuth: (selector) => selector(auth.state) }));
const setAuth = (partial) => { auth.state = { ...auth.state, ...partial }; };

vi.mock('../../lib/supabase.js', () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) } },
}));

const pages = await import('./index.js');

const render = (Component, path = '/', props = {}) => renderToString(
  createElement(MemoryRouter, { initialEntries: [path] }, createElement(Component, props)),
);
const signedIn = () => setAuth({ status: 'signed-in', user: { id: 'u1', email: 'ada@example.com', fullName: 'Ada' }, recovery: false });

beforeEach(() => { auth.state = { status: 'loading', user: null, recovery: false, init: () => {}, signOut: async () => ({ ok: true }) }; });

describe('guest pages render while the session is loading', () => {
  it('LoginPage', () => {
    const html = render(pages.LoginPage, '/account/login');
    expect(html).toContain('Sign in');
    expect(html).toContain('type="email"');
    expect(html).toContain('Forgot your password?');
    expect(html).toContain('not linked to an account automatically');
    expect(html).not.toMatch(/demo/i);
  });

  it('RegisterPage', () => {
    const html = render(pages.RegisterPage, '/account/register');
    expect(html).toContain('Create account');
    expect(html).toContain('At least 10 characters');
    expect(html).not.toMatch(/demo/i);
    expect(html).not.toContain('If this address can be registered');
  });

  it('ForgotPasswordPage', () => {
    const html = render(pages.ForgotPasswordPage, '/account/forgot-password');
    expect(html).toContain('Send reset instructions');
    expect(html).not.toMatch(/demo/i);
  });

  it('ResetPasswordPage waits for the link check, then refuses without a recovery session', () => {
    expect(render(pages.ResetPasswordPage, '/account/reset-password')).toContain('Checking your reset link');
    setAuth({ status: 'signed-out' });
    const html = render(pages.ResetPasswordPage, '/account/reset-password');
    expect(html).toContain('not valid or has expired');
    expect(html).toContain('/account/forgot-password');
    expect(html).not.toContain('type="password"');
  });

  it('ResetPasswordPage shows the form for a recovery session, and refuses a link carrying an error', () => {
    setAuth({ status: 'signed-in', user: { id: 'u1', email: 'a@b.co', fullName: '' }, recovery: true });
    const form = render(pages.ResetPasswordPage, '/account/reset-password');
    expect(form).toContain('Save new password');
    expect(form).toContain('Confirm new password');
    const expired = render(pages.ResetPasswordPage, '/account/reset-password?error=access_denied&error_code=otp_expired');
    expect(expired).toContain('not valid or has expired');
  });

  it('LoginPage redirects (renders nothing) when already signed in', () => {
    signedIn();
    expect(render(pages.LoginPage, '/account/login')).toBe('');
  });
});

describe('account pages', () => {
  const accountPages = [
    ['DashboardPage', '/account', 'Your account'],
    ['OrdersPage', '/account/orders', 'Order history'],
    ['OrderDetailPage', '/account/orders/OV-261019-1A2B3C4D', 'Order details'],
    ['AddressesPage', '/account/addresses', 'Address book'],
    ['ProfilePage', '/account/profile', 'Profile'],
  ];

  it.each(accountPages)('%s shows a loading state while the session loads', (name, path, title) => {
    const html = render(pages[name], path);
    expect(html).toContain(title);
    expect(html).toContain('Loading your account');
  });

  it.each(accountPages)('%s sends signed-out visitors to sign in without throwing', (name, path) => {
    setAuth({ status: 'signed-out' });
    expect(() => render(pages[name], path)).not.toThrow();
    expect(render(pages[name], path)).not.toContain('Order history');
  });

  it.each(accountPages)('%s shows the signed-in shell and its own loading state', (name, path, title) => {
    signedIn();
    const html = render(pages[name], path);
    expect(html).toContain(title);
    expect(html).toContain('aria-label="Account"');
    expect(html).toContain('Sign out');
    expect(html).toMatch(/Loading/);
  });

  it('ProfilePage offers a password change with a current-password check', () => {
    signedIn();
    const html = render(pages.ProfilePage, '/account/profile');
    expect(html).toContain('Change password');
    expect(html).toContain('Current password');
    expect(html).toContain('ada@example.com');
  });
});

describe('public support pages', () => {
  it('TrackOrderPage renders the guest form for a visitor', () => {
    setAuth({ status: 'signed-out' });
    const html = render(pages.TrackOrderPage, '/pages/track-order');
    expect(html).toContain('Track an order');
    expect(html).toContain('Order number');
    expect(html).toContain('Access code');
    expect(html).toContain('recorded by the store');
    expect(html).toContain('not linked to an account automatically');
    expect(html).not.toContain('Your orders');
    expect(html).not.toMatch(/demo|sample/i);
  });

  it('TrackOrderPage adds the visitor\'s own orders when signed in', () => {
    signedIn();
    const html = render(pages.TrackOrderPage, '/pages/track-order');
    expect(html).toContain('Your orders');
    expect(html).toContain('Loading your orders');
  });

  it('ReturnsPage has a hidden, empty honeypot and promises nothing', () => {
    const html = render(pages.ReturnsPage, '/pages/returns');
    expect(html).toContain('Returns &amp; exchanges');
    expect(html).toContain('Save my request');
    const trap = /<div class="ov-sr-only" aria-hidden="true"><label>[^<]*<input([^>]*)\/><\/label><\/div>/.exec(html);
    expect(trap).not.toBeNull();
    expect(trap[1]).toContain('name="website"');
    expect(trap[1]).toContain('tabindex="-1"');
    expect(trap[1]).toContain('value=""');
    expect(html).toContain('No email is sent automatically');
    expect(html).toContain('does not mean a return, exchange or refund has been approved');
    expect(html).not.toMatch(/demo|within \d+ days|full refund/i);
  });
});

describe('OrderSummaryView', () => {
  const order = {
    order_number: 'OV-261019-1A2B3C4D', placed_at: '2026-10-19T10:00:00Z', customer_name: 'Ada <b>Lovelace</b>', email_hint: 'a***@example.com',
    shipping_address: { recipient: 'Ada', line1: '1 Road', line2: '', city: 'Lahore', province: 'Punjab', postal_code: '54000', country: 'PK' },
    currency: 'PKR', subtotal_pkr: 12000, shipping_pkr: 250, tax_pkr: 0, tax_status: 'not_calculated', total_pkr: 12250,
    payment_method: 'Cash on delivery', payment_status: 'unpaid', fulfilment_status: 'shipped', shipping_method: 'Standard delivery',
    tracking_carrier: 'TCS', tracking_number: '123456', tracking_url: 'https://courier.example/t/123456',
    items: [{ product_slug: 'quarter-zip-olive', product_name: '<script>alert(1)</script> Zip', sku: 'QZ-1', color: 'Olive', size: 'M', unit_price_pkr: 12000, quantity: 1, line_total_pkr: 12000 }],
    events: [{ kind: 'order_placed', message: 'Order received. Payment is due on delivery.', created_at: '2026-10-19T10:00:00Z' }],
  };

  it('renders the projection honestly', () => {
    const html = render(pages.OrderSummaryView, '/', { order });
    expect(html).toContain('OV-261019-1A2B3C4D');
    expect(html).toContain('PKR 12,250');
    expect(html).toContain('PKR 250');
    expect(html).toContain('Taxes not calculated');
    expect(html).toContain('Cash on delivery');
    expect(html).toContain('Shipped');
    expect(html).toContain('TCS');
    expect(html).toContain('href="https://courier.example/t/123456"');
    expect(html).toContain('recorded by the store');
    expect(html).toContain('Order received. Payment is due on delivery.');
    expect(html).toContain('href="/product/quarter-zip-olive"');
  });

  it('escapes customer-controlled text', () => {
    const html = render(pages.OrderSummaryView, '/', { order });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Lovelace</b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('never links a non-http tracking URL and says so when nothing is recorded', () => {
    const html = render(pages.OrderSummaryView, '/', { order: { ...order, tracking_url: 'javascript:alert(1)', tracking_carrier: null, tracking_number: null } });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('No tracking details have been recorded');
  });

  it('copes with a minimal projection and renders nothing for null', () => {
    expect(() => render(pages.OrderSummaryView, '/', { order: { order_number: 'OV-261019-1A2B3C4D' } })).not.toThrow();
    expect(render(pages.OrderSummaryView, '/', { order: null })).toBe('');
  });
});
