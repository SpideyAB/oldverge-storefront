import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Footer, Header } from './components/Shell.jsx';
import BrandLoader from './components/BrandLoader.jsx';
import BackendGate, { useBackendBootstrap } from './components/BackendGate.jsx';
import { heroImages } from './components/HomeHero.jsx';
import { HomePage, ShopPage } from './pages.jsx';
import ProductPage from './pages/ProductPage.jsx';
import CartPage from './pages/CartPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import ConfirmationPage from './pages/ConfirmationPage.jsx';
import LiveCheckoutPage from './pages/checkout/LiveCheckoutPage.jsx';
import LiveConfirmationPage from './pages/checkout/LiveConfirmationPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import * as demoAccount from './pages/account.jsx';
import * as livePages from './pages/live/index.js';
import { ReturnsPage as DemoReturnsPage, ShippingPage, TrackOrderPage as DemoTrackOrderPage } from './pages/support.jsx';
import AboutPage from './pages/AboutPage.jsx';
import FaqPage from './pages/FaqPage.jsx';
import ContactPage from './pages/ContactPage.jsx';
import PolicyPage from './components/PolicyPage.jsx';
import { policyPath } from './data/policies.js';
import { PAGE_META } from './data/siteInfo.js';
import { useStore } from './store.js';
import SmoothScroll from './components/SmoothScroll.jsx';
import { productBySlug } from './data/catalog.js';
import { getPolicies, useSite } from './data/site.js';
import { shopTitle } from './data/collections.js';
import { isBackend } from './lib/config.js';

// The owner's admin area is a separate chunk: visitors to the shop never download it.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

const TITLES = {
  '/cart': ['Cart', 'Review the items in your cart.'],
  '/checkout': ['Checkout', 'Demo checkout. No payment is taken.'],
  '/order-confirmation': ['Order confirmation', 'Your demo order summary.'],
  '/search': ['Search', 'Search OLDVERGE watches and quarter zips.'],
  '/account': ['Your account', 'Demo account dashboard.'],
  '/account/login': ['Sign in', 'Sign in to the OLDVERGE demo account.'],
  '/account/register': ['Create account', 'Create an OLDVERGE demo account.'],
  '/account/forgot-password': ['Reset password', 'Demo password reset.'],
  '/account/orders': ['Order history', 'Sample order history.'],
  '/account/addresses': ['Address book', 'Manage demo addresses.'],
  '/account/profile': ['Profile', 'Edit your demo profile.'],
  '/pages/shipping': ['Shipping & delivery', 'Sample delivery options for the OLDVERGE demo.'],
  '/pages/returns': ['Returns & exchanges', 'Returns and exchanges at OLDVERGE.'],
  '/pages/track-order': ['Track an order', 'See a sample order tracking result.'],
};
const LIVE_TITLES = {
  '/cart': ['Cart', 'Review the items in your cart.'],
  '/checkout': ['Checkout', 'Check out with OLDVERGE.'],
  '/order-confirmation': ['Order confirmation', 'Your OLDVERGE order.'],
  '/search': ['Search', 'Search OLDVERGE watches and quarter zips.'],
  '/account': ['Your account', 'Your OLDVERGE account.'],
  '/account/login': ['Sign in', 'Sign in to your OLDVERGE account.'],
  '/account/register': ['Create account', 'Create an OLDVERGE account.'],
  '/account/forgot-password': ['Reset password', 'Reset your OLDVERGE password.'],
  '/account/reset-password': ['Set a new password', 'Choose a new OLDVERGE password.'],
  '/account/orders': ['Order history', 'Your OLDVERGE orders.'],
  '/account/addresses': ['Address book', 'Your saved addresses.'],
  '/account/profile': ['Profile', 'Your OLDVERGE profile.'],
  '/pages/returns': ['Returns & exchanges', 'Ask about a return or exchange.'],
  '/pages/track-order': ['Track an order', 'Track an OLDVERGE order.'],
};

function Redirect({ to }) { return <Navigate to={to} replace />; }
function CollectionRedirect() { const { handle } = useParams(); return <Navigate to={handle === 'all' ? '/shop' : `/shop/${handle}`} replace />; }
function ProductRedirect() { const { handle } = useParams(); return <Navigate to={`/product/${handle}`} replace />; }

// Demo mode keeps the original sample screens. Backend mode uses the Supabase-backed ones.
const account = isBackend ? livePages : demoAccount;
const ReturnsPage = isBackend ? livePages.ReturnsPage : DemoReturnsPage;
const TrackOrderPage = isBackend ? livePages.TrackOrderPage : DemoTrackOrderPage;
const Checkout = isBackend ? LiveCheckoutPage : CheckoutPage;
const Confirmation = isBackend ? LiveConfirmationPage : ConfirmationPage;
const gated = (element) => <BackendGate>{element}</BackendGate>;

function RouteContent() {
  const location = useLocation();
  const policies = useSite((state) => state.policies);
  useEffect(() => {
    const path = location.pathname.replace(/\/$/, '') || '/';
    const policy = getPolicies().find((item) => policyPath(item) === path);
    const product = path.startsWith('/product/') ? productBySlug(path.split('/').pop()) : null;
    const info = (isBackend ? LIVE_TITLES : TITLES)[path] || PAGE_META[path];
    const title = product ? `${product.name} | OLDVERGE`
      : path.startsWith('/shop') ? shopTitle(path, location.search)
        : path.startsWith('/account/orders/') ? 'Order details | OLDVERGE'
          : path.startsWith('/admin') ? 'Admin | OLDVERGE'
            : info ? `${info[0]} | OLDVERGE`
              : policy ? `${policy.title} | OLDVERGE`
                : path === '/' ? 'OLDVERGE — Good taste. No noise.' : 'Page not found | OLDVERGE';
    document.title = title;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = product ? `${product.name}. ${product.description} OLDVERGE, Pakistan.` : info?.[1] || policy?.description || 'Quarter zips and watches for everyday wear. OLDVERGE, Pakistan.';
  }, [location.pathname, location.search, policies]);
  // Keyed by path only: changing filters or sort (query string) updates the same page in place.
  return <div key={location.pathname} className="ov-page-enter"><Routes location={location}>
    <Route path="/" element={gated(<HomePage />)} />
    <Route path="/shop" element={gated(<ShopPage />)} /><Route path="/shop/:category" element={gated(<ShopPage />)} />
    <Route path="/collections" element={<Redirect to="/shop" />} /><Route path="/collections/:handle" element={<CollectionRedirect />} />
    <Route path="/product/:slug" element={gated(<ProductPage />)} /><Route path="/products/:handle" element={<ProductRedirect />} />
    <Route path="/cart" element={gated(<CartPage />)} /><Route path="/checkout" element={gated(<Checkout />)} />
    <Route path="/order-confirmation" element={<Confirmation />} />
    <Route path="/search" element={gated(<SearchPage />)} />
    <Route path="/account" element={<account.DashboardPage />} /><Route path="/account/login" element={<account.LoginPage />} /><Route path="/account/register" element={<account.RegisterPage />} />
    <Route path="/account/forgot-password" element={<account.ForgotPasswordPage />} />
    {isBackend && <Route path="/account/reset-password" element={<livePages.ResetPasswordPage />} />}
    <Route path="/account/orders" element={<account.OrdersPage />} /><Route path="/account/orders/:id" element={<account.OrderDetailPage />} />
    <Route path="/account/addresses" element={<account.AddressesPage />} /><Route path="/account/profile" element={<account.ProfilePage />} />
    <Route path="/about" element={<AboutPage />} /><Route path="/faq" element={<FaqPage />} /><Route path="/contact" element={<ContactPage />} />
    <Route path="/pages/about" element={<Redirect to="/about" />} /><Route path="/pages/faq" element={<Redirect to="/faq" />} /><Route path="/pages/contact" element={<Redirect to="/contact" />} />
    {/* One canonical delivery page: the owner's published Shipping Policy. The demo's sample page exists only in demo mode. */}
    <Route path="/pages/shipping" element={isBackend ? <Redirect to="/shipping" /> : <ShippingPage />} />
    <Route path="/pages/returns" element={<ReturnsPage />} /><Route path="/pages/track-order" element={<TrackOrderPage />} />
    {policies.map((policy) => <Route key={policy.slug} path={policyPath(policy)} element={<PolicyPage policy={policy} />} />)}
    {policies.flatMap((policy) => (policy.aliases || []).map((alias) => <Route key={alias} path={alias} element={<Navigate to={policyPath(policy)} replace />} />))}
    <Route path="/policies/privacy-policy" element={<Redirect to="/privacy-policy" />} /><Route path="/policies/terms-of-service" element={<Redirect to="/terms-and-conditions" />} /><Route path="/policies/refund-policy" element={<Redirect to="/refund-policy" />} />
    <Route path="/wishlist" element={<Redirect to="/shop" />} /><Route path="/size-guide" element={<Redirect to="/faq#sizing" />} />
    <Route path="/admin/*" element={<Suspense fallback={<main className="ov-backend-state" aria-busy="true"><p role="status">Loading…</p></main>}><AdminApp /></Suspense>} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes></div>;
}

export default function App() {
  const announcement = useStore((state) => state.announcement);
  const cartOpen = useStore((state) => state.cartOpen);
  const location = useLocation();
  const inAdmin = location.pathname.startsWith('/admin');
  useBackendBootstrap();
  useSite((state) => state.siteImages);
  useEffect(() => {
    // The site always renders in its light theme.
    document.documentElement.dataset.theme = 'light';
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = '#F4F0E7';
  }, []);
  useEffect(() => {
    // The admin area must never be indexed.
    let tag = document.querySelector('meta[name="robots"]');
    if (inAdmin) {
      if (!tag) { tag = document.createElement('meta'); tag.name = 'robots'; document.head.appendChild(tag); }
      tag.content = 'noindex, nofollow';
    } else if (tag) tag.remove();
  }, [inAdmin]);
  return <div className="app-shell"><SmoothScroll />{!inAdmin && <Header />}<RouteContent />{!inAdmin && <Footer />}
    {!inAdmin && <BrandLoader readyImages={heroImages().slice(0, 6).map((image) => image.src)} />}
    <div className="ov-sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    {announcement && !cartOpen && <div className="toast-message" aria-hidden="true">{announcement}</div>}
  </div>;
}
