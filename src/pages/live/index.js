// Supabase-backed account, order-tracking and returns pages. Prop-less, same names as the demo pages in
// src/pages/account.jsx and src/pages/support.jsx, so a route can swap one for the other.
export { LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage } from './AuthPages.jsx';
export { DashboardPage, OrdersPage, OrderDetailPage, AddressesPage, ProfilePage } from './AccountPages.jsx';
export { TrackOrderPage, ReturnsPage } from './SupportPages.jsx';
export { default as OrderSummaryView } from './OrderSummaryView.jsx';
