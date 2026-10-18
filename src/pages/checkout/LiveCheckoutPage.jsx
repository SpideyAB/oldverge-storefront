import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatPrice } from '../../lib/money.js';
import { resolveLines, useStore } from '../../store.js';
import { optionText } from '../../components/CartDrawer.jsx';
import { EMAIL_PATTERN, EmptyState, Field } from '../../components/ui.jsx';
import { imageSize } from '../../data/imageSizes.js';
import { useCatalog } from '../../data/catalog.js';
import { orderingOpen, useSite } from '../../data/site.js';
import { attemptFor, clearAttempt, confirmationHash, explainOrderError, payloadFingerprint, requestQuote, submitOrder, toOrderLines } from '../../lib/checkout.js';
import { PROVINCES } from '../CheckoutPage.jsx';

const BLANK = { firstName: '', lastName: '', line1: '', line2: '', city: '', province: '', postalCode: '' };
const FIELD_TO_KEY = { 'contact.email': 'email', 'contact.phone': 'phone', 'address.line1': 'line1', 'address.city': 'city', 'address.province': 'province', 'address.postal_code': 'postalCode' };

function validate(contact, address) {
  const found = {};
  if (!contact.email.trim()) found.email = 'Enter your email address.';
  else if (!EMAIL_PATTERN.test(contact.email.trim())) found.email = 'Enter a valid email address, like name@example.com.';
  if (!contact.phone.trim()) found.phone = 'Enter a phone number for the courier.';
  else if (!/^\+?[0-9][0-9 ()-]{3,28}[0-9]$/.test(contact.phone.trim())) found.phone = 'Enter a valid phone number, for example 0300 0000000 or +44 20 7946 0958.';
  if (!address.firstName.trim()) found.firstName = 'Enter a first name.';
  if (!address.lastName.trim()) found.lastName = 'Enter a last name.';
  if (!address.line1.trim()) found.line1 = 'Enter the street address.';
  if (!address.city.trim()) found.city = 'Enter the city.';
  if (!address.province) found.province = 'Choose a province or territory.';
  if (address.postalCode.trim() && !/^\d{5}$/.test(address.postalCode.trim())) found.postalCode = 'Postal codes in Pakistan have 5 digits, for example 54000.';
  return found;
}

/**
 * Checkout against Supabase. The server derives every price, delivery charge and total (quote-order) and creates the
 * order atomically (create-order). This page never decides money: it shows the server quote, asks for a fresh
 * confirmation if the total changed, and uses one idempotency key per distinct request so a double click or a retry
 * after a lost response cannot place two orders. Nothing about the order is kept in the browser after it succeeds.
 */
export default function LiveCheckoutPage() {
  const [params] = useSearchParams();
  const buyNow = params.get('mode') === 'buy-now';
  const source = buyNow ? 'buy-now' : 'cart';
  const navigate = useNavigate();
  useSite((state) => state.settings);
  const shippingMethods = useSite((state) => state.shippingMethods);
  const paymentMethods = useSite((state) => state.paymentMethods).filter((method) => method.kind === 'cod');   // online payments need a provider adapter
  const cart = useStore((state) => state.cart);
  const directItem = useStore((state) => state.directItem);
  const finishCheckout = useStore((state) => state.finishCheckout);
  const lines = useMemo(() => resolveLines(buyNow ? (directItem ? [directItem] : []) : cart), [buyNow, directItem, cart]);
  const [contact, setContact] = useState({ email: '', phone: '' });
  const [address, setAddress] = useState(BLANK);
  const [shippingCode, setShippingCode] = useState('');
  const [paymentCode, setPaymentCode] = useState('');
  const [errors, setErrors] = useState({});
  const [quotes, setQuotes] = useState({});                // { [shipping code]: { quote } | { error } } for the chosen province
  const [problem, setProblem] = useState(null);            // { kind, message }
  const [needsReconfirm, setNeedsReconfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const summaryRef = useRef(null);
  const quoteSeq = useRef(0);

  const orderLines = useMemo(() => toOrderLines(lines), [lines]);
  const activeShipping = shippingCode || shippingMethods[0]?.code || '';
  const activePayment = paymentCode || paymentMethods[0]?.code || '';
  const selected = quotes[activeShipping]?.quote || null;

  // Server quotes for every enabled delivery method once a province is chosen (authoritative prices).
  useEffect(() => {
    if (!address.province || !orderLines.ok || !activePayment || !shippingMethods.length) { setQuotes({}); return undefined; }
    const seq = quoteSeq.current + 1; quoteSeq.current = seq;
    const timer = window.setTimeout(async () => {
      const results = await Promise.all(shippingMethods.map(async (method) => {
        const result = await requestQuote({ lines: orderLines.lines, shipping_method: method.code, province: address.province, payment_method: activePayment });
        return [method.code, result.ok ? { quote: result.data.quote } : { error: result.data?.error || 'error', status: result.status }];
      }));
      if (quoteSeq.current === seq) setQuotes(Object.fromEntries(results));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [address.province, orderLines, activePayment, shippingMethods]);

  if (!orderingOpen()) {
    return <main id="main-content" className="ov-page ov-checkout">
      <EmptyState title="Orders are not open yet." actions={<><Link to="/shop" className="ov-button ov-button-dark">Keep browsing</Link>{lines.length > 0 && !buyNow && <Link to="/cart" className="ov-button ov-button-light">View bag</Link>}</>}>
        The store is not taking orders at the moment. Your bag is saved in this browser until it does.
      </EmptyState>
    </main>;
  }
  if (!lines.length) {
    return <main id="main-content" className="ov-page ov-checkout">
      <EmptyState title={buyNow ? 'Your Buy now item is no longer available.' : 'Nothing to check out yet.'} actions={<><Link to="/shop" className="ov-button ov-button-dark">Back to shopping</Link>{!buyNow && <Link to="/cart" className="ov-button ov-button-light">View cart</Link>}</>}>
        {buyNow ? 'Choose the product again and use Buy now.' : 'Your cart is empty. Add something first, then come back to check out.'}
      </EmptyState>
    </main>;
  }
  if (!shippingMethods.length || !paymentMethods.length) {
    return <main id="main-content" className="ov-page ov-checkout">
      <EmptyState title="Checkout is not available yet." actions={<Link to="/shop" className="ov-button ov-button-dark">Back to shopping</Link>}>
        Delivery or payment options have not been set up, so an order cannot be placed right now.
      </EmptyState>
    </main>;
  }

  const refreshAfterStockProblem = () => {
    useCatalog.getState().load({ force: true }).then(() => useStore.getState().reconcileCart());
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    const found = validate(contact, address);
    if (!orderLines.ok) found.cart = 'An item in your bag is no longer available. Review your bag.';
    if (!selected) found.shipping = 'Choose your province, then a delivery method, to see the total.';
    setErrors(found);
    const keys = Object.keys(found);
    if (keys.length) {
      window.setTimeout(() => (document.querySelector(`[name="${keys[0]}"]`) || summaryRef.current)?.focus(), 0);
      return;
    }
    submitLock.current = true; setSubmitting(true); setProblem(null);
    const payload = {
      lines: orderLines.lines, shipping_method: activeShipping, payment_method: activePayment,
      contact: { name: `${address.firstName.trim()} ${address.lastName.trim()}`, email: contact.email.trim(), phone: contact.phone.trim() },
      address: { recipient: `${address.firstName.trim()} ${address.lastName.trim()}`, line1: address.line1.trim(), line2: address.line2.trim(), city: address.city.trim(), province: address.province, postal_code: address.postalCode.trim(), country: 'PK' },
    };
    const { key, secret } = attemptFor(window.sessionStorage, source, await payloadFingerprint(payload));
    const result = await submitOrder({ ...payload, idempotency_key: key, checkout_secret: secret, expected_total_pkr: selected.total_pkr });
    submitLock.current = false; setSubmitting(false);
    if (result.ok) {
      clearAttempt(window.sessionStorage);
      finishCheckout(source);
      navigate({ pathname: '/order-confirmation', hash: confirmationHash(result.data.order_number, result.data.access_token) }, { replace: true });
      return;
    }
    const explained = explainOrderError(result.status, result.data);
    if (explained.kind === 'price_changed') {
      setQuotes((current) => ({ ...current, [activeShipping]: { quote: explained.quote } }));
      setNeedsReconfirm(true);
    }
    if (explained.kind === 'stock') refreshAfterStockProblem();
    if (explained.kind === 'closed') useSite.getState().load({ force: true });
    if (explained.kind === 'restart') clearAttempt(window.sessionStorage);
    if (explained.kind === 'field' && FIELD_TO_KEY[explained.field]) setErrors({ [FIELD_TO_KEY[explained.field]]: explained.message });
    setProblem(explained);
    window.setTimeout(() => summaryRef.current?.focus(), 0);
  };

  const errorList = Object.entries(errors);
  const field = (key, label, props = {}) => <Field key={key} label={label} name={key} value={address[key]} error={errors[key]} onChange={(event) => { setAddress({ ...address, [key]: event.target.value }); setNeedsReconfirm(false); }} autoComplete={`shipping ${props.ac}`} {...props.input} />;

  return <main id="main-content" className="ov-page ov-checkout">
    <header className="ov-page-head"><h1>Checkout</h1><p className="ov-page-intro">{buyNow ? 'You are buying one item with Buy now. Your bag is untouched.' : 'Review your bag and enter your details.'} The total is calculated by the store when you choose your delivery method.</p></header>
    <div className="ov-checkout-layout">
      <form onSubmit={submit} noValidate className="ov-checkout-form">
        {(errorList.length > 0 || problem) && <div className="ov-error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
          {problem && <h2>{problem.message}</h2>}
          {errorList.length > 0 && <><h2>Please fix {errorList.length === 1 ? 'one thing' : `${errorList.length} things`} to continue</h2><ul>{errorList.map(([key, message]) => <li key={key}>{message}</li>)}</ul></>}
        </div>}
        <section aria-labelledby="co-contact"><h2 id="co-contact">Contact</h2>
          <Field label="Email" name="email" type="email" autoComplete="email" value={contact.email} error={errors.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} />
          <Field label="Phone" name="phone" type="tel" autoComplete="tel" value={contact.phone} error={errors.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} />
        </section>
        <section aria-labelledby="co-ship"><h2 id="co-ship">Shipping address</h2>
          <p className="ov-field-hint">Country: Pakistan</p>
          <div className="ov-field-row">{field('firstName', 'First name', { ac: 'given-name' })}{field('lastName', 'Last name', { ac: 'family-name' })}</div>
          {field('line1', 'Address', { ac: 'address-line1' })}
          {field('line2', 'Apartment, suite or floor (optional)', { ac: 'address-line2' })}
          <div className="ov-field-row">{field('city', 'City', { ac: 'address-level2' })}
            <Field label="Province or territory" as="select" name="province" value={address.province} error={errors.province} onChange={(event) => { setAddress({ ...address, province: event.target.value }); setNeedsReconfirm(false); }} autoComplete="shipping address-level1"><option value="">Select</option>{PROVINCES.map((province) => <option key={province} value={province}>{province}</option>)}</Field>
          </div>
          {field('postalCode', 'Postal code (optional)', { ac: 'postal-code', input: { inputMode: 'numeric', maxLength: 5 } })}
        </section>
        <fieldset className="ov-radio-group" aria-describedby={errors.shipping ? 'co-ship-err' : undefined}><legend>Delivery method</legend>
          {!address.province && <p className="ov-field-hint">Choose your province to see delivery prices.</p>}
          {errors.shipping && <p className="ov-field-error" id="co-ship-err">{errors.shipping}</p>}
          {shippingMethods.map((method) => {
            const result = quotes[method.code];
            const price = result?.quote ? result.quote.shipping_pkr : null;
            return <label key={method.code} className={`ov-radio ${activeShipping === method.code ? 'is-checked' : ''}`}>
              <input type="radio" name="shipping" value={method.code} checked={activeShipping === method.code} onChange={() => { setShippingCode(method.code); setNeedsReconfirm(false); }} />
              <span><strong>{method.label}</strong>{method.estimate_text && <small>{method.estimate_text}</small>}</span>
              <b>{!address.province ? '' : result?.error ? 'Not available' : price === null ? '…' : price === 0 ? 'Free' : formatPrice(price)}</b></label>;
          })}
        </fieldset>
        <fieldset className="ov-radio-group"><legend>Payment</legend>
          {paymentMethods.map((method) => <label key={method.code} className={`ov-radio ${activePayment === method.code ? 'is-checked' : ''}`}>
            <input type="radio" name="payment" value={method.code} checked={activePayment === method.code} onChange={() => setPaymentCode(method.code)} />
            <span><strong>{method.label}</strong>{method.description && <small>{method.description}</small>}</span></label>)}
        </fieldset>
        <button type="submit" className="ov-button ov-button-dark ov-place-order" disabled={submitting}>{submitting ? 'Placing your order…' : needsReconfirm ? 'Confirm the new total and place order' : 'Place order'}</button>
        <p className="ov-note">Your details are sent to the store to fulfil this order. No card details are collected.</p>
      </form>
      <aside className="ov-summary" aria-label="Order summary">
        <h2>{buyNow ? 'Buying now' : 'Your bag'}</h2>
        <ul className="ov-summary-lines">{lines.map((line) => <li key={line.key}>
          <span className="ov-summary-thumb">{line.product.image && <img src={line.product.image} alt="" {...imageSize(line.product.image)} />}<i aria-hidden="true">{line.quantity}</i></span>
          <span className="ov-summary-name">{line.product.name}<small>{optionText(line)} · Qty {line.quantity}</small></span><strong>{formatPrice(line.lineTotal)}</strong></li>)}</ul>
        <div className="ov-row"><span>Subtotal</span><strong>{formatPrice(selected ? selected.subtotal_pkr : lines.reduce((sum, line) => sum + line.lineTotal, 0))}</strong></div>
        <div className="ov-row"><span>Delivery</span><strong>{selected ? (selected.shipping_pkr === 0 ? 'Free' : formatPrice(selected.shipping_pkr)) : 'Choose province'}</strong></div>
        <div className="ov-row"><span>Taxes</span><strong>Not calculated</strong></div>
        <div className="ov-row ov-row-total"><span>Total</span><strong>{selected ? formatPrice(selected.total_pkr) : '…'}</strong></div>
        {needsReconfirm && <p className="ov-note" role="status">The total changed. Review it above, then confirm.</p>}
        {!buyNow && <Link to="/cart" className="ov-text-link">Edit bag</Link>}
      </aside>
    </div>
  </main>;
}
