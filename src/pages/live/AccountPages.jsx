import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth, validatePassword, PASSWORD_MIN_LENGTH } from '../../lib/auth.js';
import { formatPrice } from '../../lib/money.js';
import { EmptyState, Field, PasswordField } from '../../components/ui.jsx';
import {
  countAddresses, deleteAddress, getMyOrder, getProfile, listAddresses, listMyOrders, saveAddress, saveProfile,
} from './data.js';
import {
  BLANK_ADDRESS, MAX_ADDRESSES, PAGE_SIZE, PROVINCES, formatDate, fulfilmentLabel, paymentLabel, toProjection, validateAddress, validateProfile,
} from './helpers.js';
import OrderSummaryView from './OrderSummaryView.jsx';
import {
  AccountLayout, ErrorSummary, FormMessage, GuestOrderNotice, LoadGate, SessionExpired, useForm, useLoader,
} from './shared.jsx';

/** Page of the signed-in customer's orders with Previous / Next. Used by the orders page and the track page. */
export function OrdersList({ page, onPage, pageSize = PAGE_SIZE, heading }) {
  const userId = useAuth((state) => state.user?.id);
  const state = useLoader(() => listMyOrders({ page, pageSize }), `${userId}:${page}:${pageSize}`);
  return <LoadGate state={state} loadingText="Loading your orders…">
    {({ rows, total }) => {
      const pages = Math.max(1, Math.ceil(total / pageSize));
      if (!rows.length) {
        return total > 0 && page > 1
          ? <EmptyState title="No orders on this page." actions={<button type="button" className="ov-button ov-button-dark" onClick={() => onPage(1)}>Back to the first page</button>} />
          : <EmptyState title="You have no orders yet." actions={<Link to="/shop" className="ov-button ov-button-dark">Start shopping</Link>}>Orders placed while signed in will appear here.</EmptyState>;
      }
      return <section aria-label={heading || 'Your orders'}>
        <ul className="ov-order-list">{rows.map((order) => <li key={order.id}>
          <div>
            <Link to={`/account/orders/${order.order_number}`}><strong>{order.order_number}</strong></Link>
            <span>{formatDate(order.placed_at)} · {fulfilmentLabel(order.fulfilment_status)} · {paymentLabel(order.payment_status)}</span>
          </div>
          <p>{order.item_count} {order.item_count === 1 ? 'item' : 'items'}</p>
          <strong>{formatPrice(order.total_pkr)}</strong>
        </li>)}</ul>
        {pages > 1 && <nav className="ov-form-actions" aria-label="Orders pages">
          <button type="button" className="ov-button ov-button-light" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
          <p className="ov-note" aria-live="polite">Page {page} of {pages}</p>
          <button type="button" className="ov-button ov-button-light" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
        </nav>}
      </section>;
    }}
  </LoadGate>;
}

function DashboardBody() {
  const user = useAuth((state) => state.user);
  const profile = useLoader(() => (user ? getProfile(user.id) : Promise.resolve({ ok: true, data: { display_name: '', phone: '' } })), user?.id || 'none');
  const recent = useLoader(() => listMyOrders({ page: 1, pageSize: 3 }), user?.id || 'none');
  const addresses = useLoader(() => countAddresses(), user?.id || 'none');
  const expired = [profile, recent, addresses].some((entry) => entry.status === 'error' && entry.error?.error === 'expired');
  const name = profile.data?.display_name || user?.fullName || '';
  return <>
    {expired && <SessionExpired />}
    <h2>Hello{name ? `, ${name}` : ''}</h2>
    <p>{user?.email}</p>
    <ul className="ov-stat-list">
      <li><strong>{recent.status === 'ready' ? recent.data.total : '–'}</strong> {recent.data?.total === 1 ? 'order' : 'orders'}</li>
      <li><strong>{addresses.status === 'ready' ? addresses.data : '–'}</strong> saved {addresses.data === 1 ? 'address' : 'addresses'}</li>
    </ul>
    <h2>Recent orders</h2>
    <LoadGate state={recent} loadingText="Loading your orders…">
      {({ rows }) => (rows.length
        ? <>
          <ul className="ov-order-list">{rows.map((order) => <li key={order.id}>
            <div><Link to={`/account/orders/${order.order_number}`}><strong>{order.order_number}</strong></Link><span>{formatDate(order.placed_at)} · {fulfilmentLabel(order.fulfilment_status)}</span></div>
            <p>{order.item_count} {order.item_count === 1 ? 'item' : 'items'}</p>
            <strong>{formatPrice(order.total_pkr)}</strong>
          </li>)}</ul>
          <p><Link to="/account/orders" className="ov-text-link">View all orders</Link></p>
        </>
        : <p>You have no orders yet.</p>)}
    </LoadGate>
    <GuestOrderNotice />
  </>;
}

export const DashboardPage = () => <AccountLayout title="Your account"><DashboardBody /></AccountLayout>;

function OrdersBody() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  return <>
    <OrdersList page={page} onPage={(next) => setParams(next > 1 ? { page: String(next) } : {})} />
    <GuestOrderNotice />
  </>;
}

export const OrdersPage = () => <AccountLayout title="Order history"><OrdersBody /></AccountLayout>;

function OrderDetailBody() {
  const { id } = useParams();
  const userId = useAuth((state) => state.user?.id);
  const state = useLoader(() => getMyOrder(id), `${userId}:${id}`);
  return <>
    <LoadGate state={state} loadingText="Loading this order…">
      {(row) => (row
        ? <><OrderSummaryView order={toProjection(row)} /><p><Link to="/account/orders" className="ov-text-link">Back to orders</Link></p></>
        : <EmptyState title="We could not find that order on your account." actions={<><Link to="/account/orders" className="ov-button ov-button-dark">Back to orders</Link><Link to="/pages/track-order" className="ov-button ov-button-light">Track an order</Link></>}>
          Orders placed as a guest are not linked to an account automatically. Use Track an order with the order number and access code from its confirmation.
        </EmptyState>)}
    </LoadGate>
  </>;
}

export const OrderDetailPage = () => <AccountLayout title="Order details"><OrderDetailBody /></AccountLayout>;

function AddressForm({ initial, existingCount, onSaved, onCancel }) {
  const form = useForm(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setProblem('');
    if (form.fail(validateAddress(form.values))) return;
    setBusy(true);
    const result = await saveAddress({ id: initial.id, values: form.values, existingCount });
    setBusy(false);
    if (result.ok) onSaved(); else setProblem(result.message);
  };
  const provinces = form.values.province && !PROVINCES.includes(form.values.province) ? [form.values.province, ...PROVINCES] : PROVINCES;
  return <form onSubmit={submit} noValidate className="ov-form" aria-busy={busy}>
    <ErrorSummary errors={form.errors} />
    <Field label="Label (for example Home)" maxLength={40} {...form.bind('label')} />
    <Field label="Recipient name" autoComplete="name" maxLength={120} {...form.bind('recipient')} />
    <Field label="Phone number" type="tel" autoComplete="tel" maxLength={30} {...form.bind('phone')} />
    <Field label="Address" autoComplete="address-line1" maxLength={200} {...form.bind('line1')} />
    <Field label="Apartment, suite or floor (optional)" autoComplete="address-line2" maxLength={200} {...form.bind('line2')} />
    <div className="ov-field-row">
      <Field label="City" autoComplete="address-level2" maxLength={80} {...form.bind('city')} />
      <Field label="Province or territory" as="select" autoComplete="address-level1" {...form.bind('province')}><option value="">Select</option>{provinces.map((province) => <option key={province} value={province}>{province}</option>)}</Field>
    </div>
    <Field label="Postal code (optional)" inputMode="numeric" maxLength={12} autoComplete="postal-code" {...form.bind('postal_code')} />
    <label className="ov-check"><input type="checkbox" checked={Boolean(form.values.is_default)} onChange={(event) => form.setValues((current) => ({ ...current, is_default: event.target.checked }))} /> Use as my default address</label>
    <FormMessage>{problem}</FormMessage>
    <div className="ov-form-actions">
      <button type="submit" className="ov-button ov-button-dark" disabled={busy}>{busy ? 'Saving…' : 'Save address'}</button>
      <button type="button" className="ov-button ov-button-light" onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  </form>;
}

function AddressesBody() {
  const userId = useAuth((state) => state.user?.id);
  const [version, setVersion] = useState(0);
  const state = useLoader(() => listAddresses(), `${userId}:${version}`);
  const [editing, setEditing] = useState(null); // null | 'new' | address row
  const [confirming, setConfirming] = useState(null);
  const [notice, setNotice] = useState({ tone: 'ok', text: '' });
  const reload = (text) => { setEditing(null); setConfirming(null); setNotice({ tone: 'ok', text }); setVersion((value) => value + 1); };
  const remove = async (address) => {
    const result = await deleteAddress(address.id);
    if (result.ok) reload('Address removed.');
    else { setConfirming(null); setNotice({ tone: 'error', text: result.message }); }
  };
  return <>
    <p role={notice.tone === 'error' ? 'alert' : 'status'} className={notice.tone === 'error' ? 'ov-form-error' : 'ov-form-ok'}>{notice.text}</p>
    <LoadGate state={state} loadingText="Loading your addresses…">
      {(addresses) => (editing
        ? <>
          <h2>{editing === 'new' ? 'Add an address' : 'Edit address'}</h2>
          <AddressForm
            initial={editing === 'new' ? { ...BLANK_ADDRESS, is_default: addresses.length === 0 } : { ...BLANK_ADDRESS, ...editing }}
            existingCount={addresses.length}
            onCancel={() => setEditing(null)}
            onSaved={() => reload('Address saved.')}
          />
        </>
        : <>
          {addresses.length
            ? <ul className="ov-address-list">{addresses.map((address) => <li key={address.id}>
              <h2>{address.label || 'Address'}{address.is_default && <span className="ov-tag">Default</span>}</h2>
              <address>{address.recipient}<br />{address.line1}{address.line2 ? `, ${address.line2}` : ''}<br />{[address.city, address.province, address.postal_code].filter(Boolean).join(', ')}<br />Pakistan<br />{address.phone}</address>
              <div className="ov-line-actions">
                {confirming === address.id
                  ? <>
                    <span role="alert">Remove this address?</span>
                    <button type="button" className="ov-link-button" onClick={() => remove(address)}>Yes, remove<span className="ov-sr-only"> {address.label}</span></button>
                    <button type="button" className="ov-link-button" onClick={() => setConfirming(null)}>Keep it</button>
                  </>
                  : <>
                    <button type="button" className="ov-link-button" onClick={() => { setNotice({ tone: 'ok', text: '' }); setEditing(address); }}>Edit<span className="ov-sr-only"> {address.label}</span></button>
                    <button type="button" className="ov-link-button" onClick={() => setConfirming(address.id)}>Remove<span className="ov-sr-only"> {address.label}</span></button>
                  </>}
              </div>
            </li>)}</ul>
            : <EmptyState title="No saved addresses.">Add an address to use at checkout.</EmptyState>}
          {addresses.length >= MAX_ADDRESSES
            ? <p className="ov-note">You have saved the maximum of {MAX_ADDRESSES} addresses. Remove one to add another.</p>
            : <button type="button" className="ov-button ov-button-dark" onClick={() => { setNotice({ tone: 'ok', text: '' }); setEditing('new'); }}>Add an address</button>}
        </>)}
    </LoadGate>
  </>;
}

export const AddressesPage = () => <AccountLayout title="Address book"><AddressesBody /></AccountLayout>;

function ProfileForm({ userId, initial }) {
  const form = useForm({ display_name: initial.display_name || '', phone: initial.phone || '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState({ tone: 'ok', text: '' });
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setResult({ tone: 'ok', text: '' });
    if (form.fail(validateProfile(form.values))) return;
    setBusy(true);
    const saved = await saveProfile(userId, form.values);
    setBusy(false);
    if (saved.ok) setResult({ tone: 'ok', text: 'Profile saved.' }); else setResult({ tone: 'error', text: saved.message });
  };
  return <form onSubmit={submit} noValidate className="ov-form" aria-busy={busy}>
    <ErrorSummary errors={form.errors} />
    <Field label="Display name" autoComplete="name" maxLength={80} {...form.bind('display_name')} />
    <Field label="Phone (optional)" type="tel" autoComplete="tel" maxLength={30} {...form.bind('phone')} />
    <button type="submit" className="ov-button ov-button-dark" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
    <FormMessage tone={result.tone}>{result.text}</FormMessage>
  </form>;
}

function ChangePasswordForm() {
  const changePassword = useAuth((state) => state.changePassword);
  const form = useForm({ current: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState({ tone: 'ok', text: '' });
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setResult({ tone: 'ok', text: '' });
    const found = {
      current: form.values.current ? null : 'Enter your current password.',
      password: validatePassword(form.values.password),
      confirm: form.values.confirm !== form.values.password ? 'The two passwords do not match.' : null,
    };
    if (form.fail(found)) return;
    setBusy(true);
    const changed = await changePassword(form.values.current, form.values.password);
    setBusy(false);
    if (changed.ok) { form.setValues({ current: '', password: '', confirm: '' }); setResult({ tone: 'ok', text: 'Password changed.' }); } else setResult({ tone: 'error', text: changed.message });
  };
  return <form onSubmit={submit} noValidate className="ov-form" aria-busy={busy}>
    <ErrorSummary errors={form.errors} />
    <PasswordField label="Current password" autoComplete="current-password" {...form.bind('current')} />
    <PasswordField label="New password" autoComplete="new-password" hint={`At least ${PASSWORD_MIN_LENGTH} characters, with an upper case letter, a lower case letter and a number.`} {...form.bind('password')} />
    <PasswordField label="Confirm new password" autoComplete="new-password" {...form.bind('confirm')} />
    <button type="submit" className="ov-button ov-button-dark" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
    <FormMessage tone={result.tone}>{result.text}</FormMessage>
  </form>;
}

function ProfileBody() {
  const user = useAuth((state) => state.user);
  const state = useLoader(() => (user ? getProfile(user.id) : Promise.resolve({ ok: true, data: { display_name: '', phone: '' } })), user?.id || 'none');
  return <>
    <h2>Your details</h2>
    <p className="ov-note">Signed in as {user?.email}. Your email address cannot be changed here.</p>
    <LoadGate state={state} loadingText="Loading your profile…">
      {(profile) => <ProfileForm userId={user.id} initial={profile} />}
    </LoadGate>
    <h2>Change password</h2>
    <ChangePasswordForm />
  </>;
}

export const ProfilePage = () => <AccountLayout title="Profile"><ProfileBody /></AccountLayout>;
