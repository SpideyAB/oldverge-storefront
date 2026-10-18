import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FREE_SHIPPING_THRESHOLD, SHIPPING_OPTIONS, formatPrice } from '../lib/money.js';
import { allOrders, orderSummary, useStore } from '../store.js';
import { getProducts } from '../data/catalog.js';
import { DemoNotice, EMAIL_PATTERN, Field, InfoSection, PageHead } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';

// These three pages describe how the service will work and show the sample values this preview uses.
// They never state a confirmed delivery area, price, time, return window or refund method: OLDVERGE has not
// supplied any, so every such point is marked as still to be confirmed (see docs/project-handover.md).

export function ShippingPage() {
  return <main id="main-content" className="ov-page ov-policy ov-info">
    <PageHead title="Shipping & delivery" intro="How delivery will work once ordering opens, and the sample options shown in this preview." />
    <DemoNotice>Draft placeholder. OLDVERGE has not confirmed delivery areas, prices or times, and orders are not open yet.</DemoNotice>
    <div className="ov-policy-body">
      <InfoSection title="Where things stand">
        <p>OLDVERGE is not accepting orders yet, so nothing is being packed or shipped. You can browse the range, add pieces to your bag and walk through the checkout steps, but no real order is created and no payment is taken.</p>
        <p>The details below explain what this page will cover once delivery is confirmed, and show the sample figures used by the preview checkout so you can see how an order would read.</p>
      </InfoSection>
      <InfoSection title="Sample delivery options">
        <table className="ov-table"><thead><tr><th scope="col">Method</th><th scope="col">Sample price</th><th scope="col">Estimate</th></tr></thead>
          <tbody>{SHIPPING_OPTIONS.map((option) => <tr key={option.id}><th scope="row">{option.label}</th><td>{formatPrice(option.price)}{option.id === 'standard' ? `, free from ${formatPrice(FREE_SHIPPING_THRESHOLD)}` : ''}</td><td>{option.estimate}</td></tr>)}</tbody></table>
        <p>Every price and estimate in this table is illustrative. Taxes are not calculated in the preview, and the free standard delivery threshold is a sample value that may change.</p>
      </InfoSection>
      <InfoSection title="Where we deliver">
        <p>Delivery coverage has not been confirmed. The preview checkout accepts addresses in Pakistan only, and the final list of cities and areas will be published on this page before the first order is accepted.</p>
      </InfoSection>
      <InfoSection title="Order processing">
        <p>The time between placing an order and handing it to the courier has not been confirmed. Once it is, it will be stated here and again at checkout, so the estimate you see before paying is the one that applies.</p>
      </InfoSection>
      <InfoSection title="Delivery charges">
        <p>Delivery charges will be shown in full at checkout before you confirm anything. The preview already separates the subtotal, the delivery charge and the total, so you can see exactly what you would pay.</p>
      </InfoSection>
      <InfoSection title="Tracking your parcel">
        <p>When ordering opens, each order will have a number you can use on the <Link to="/pages/track-order">Track an order</Link> page. In the preview, that page shows a sample result only and is not connected to a courier.</p>
      </InfoSection>
      <InfoSection title="More information">
        <p>Read the full <Link to="/shipping">Shipping Policy</Link>, see how <Link to="/pages/returns">returns and exchanges</Link> will work, browse the <Link to="/faq">FAQ</Link>, or <Link to="/contact">contact us</Link> with a question.</p>
      </InfoSection>
    </div>
  </main>;
}

export function ReturnsPage() {
  const orders = allOrders(useStore((state) => state.orders));
  const [values, setValues] = useState({ order: '', email: '', item: '', reason: '' });
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(false);
  const bind = (name) => ({ name, value: values[name], error: errors[name], onChange: (event) => { setValues({ ...values, [name]: event.target.value }); setErrors({ ...errors, [name]: undefined }); } });
  const submit = (event) => {
    event.preventDefault();
    const found = {};
    if (!values.order.trim()) found.order = 'Enter your order number.';
    if (!EMAIL_PATTERN.test(values.email.trim())) found.email = 'Enter the email address used for the order.';
    if (!values.item.trim()) found.item = 'Tell us which item this is about.';
    if (!values.reason.trim()) found.reason = 'Tell us what you would like to do and why.';
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) window.setTimeout(() => document.querySelector(`[name="${first}"]`)?.focus(), 0); else setDone(true);
  };
  return <main id="main-content" className="ov-page ov-policy ov-info">
    <PageHead title="Returns & exchanges" intro="How a return or an exchange will work once ordering opens, and a preview of the request form." />
    <DemoNotice>Draft placeholder. Return and exchange terms have not been confirmed, so no request can be processed. The form below only shows how a request would look and sends nothing. Read the <Link to="/refund-policy">Returns & Refunds policy</Link>.</DemoNotice>
    <div className="ov-policy-body">
      <InfoSection title="Where things stand">
        <p>OLDVERGE is not accepting orders yet, so there is nothing to return or exchange. The terms will be published before the first order is accepted, and this page will then be updated to match them.</p>
      </InfoSection>
      <InfoSection title="What the policy will cover">
        <p>These are the points the final terms will state clearly. None of them has been confirmed yet:</p>
        <ul className="ov-info-list">
          <li>How long after delivery a return or an exchange can be requested.</li>
          <li>The condition an item must be in, for example unworn and with its tags or packaging.</li>
          <li>Whether an exchange for another size or colour is available, and for which items.</li>
          <li>How and when a refund is paid, and to which payment method.</li>
          <li>Who pays for return delivery, and any items that cannot be returned.</li>
        </ul>
      </InfoSection>
      <InfoSection title="How a request will work">
        <ol className="ov-info-steps">
          <li><strong>Tell us about the order.</strong> Enter the order number and the email address used when ordering.</li>
          <li><strong>Choose the item.</strong> Select the piece the request is about.</li>
          <li><strong>Explain what you would like.</strong> Say whether you want to return or exchange it, and why.</li>
          <li><strong>We reply.</strong> Once real terms are in place, the OLDVERGE team will answer with the next steps.</li>
        </ol>
      </InfoSection>
    </div>
    <Reveal as="section" className="ov-info-formblock" aria-labelledby="ov-return-form-title">
      <h2 id="ov-return-form-title">Preview the request form</h2>
      {done ? <div className="ov-form-done" role="status"><h3>Demo only: no request was sent</h3><p>With real terms in place, your request for order {values.order.trim()} would go to the OLDVERGE team.</p><button type="button" className="ov-button ov-button-dark" onClick={() => { setDone(false); setValues({ order: '', email: '', item: '', reason: '' }); }}>Start another request</button></div>
        : <form className="ov-form" onSubmit={submit} noValidate>
          <Field label="Order number" hint={`For example ${orders[0]?.id || 'OV-DEMO-1001'}`} {...bind('order')} />
          <Field label="Email" type="email" autoComplete="email" {...bind('email')} />
          <Field label="Item" as="select" {...bind('item')}><option value="">Select an item</option>{getProducts().map((product) => <option key={product.id} value={product.name}>{product.name}</option>)}</Field>
          <Field label="What would you like to do, and why?" as="textarea" {...bind('reason')} />
          <button type="submit" className="ov-button ov-button-dark">Preview return request</button>
        </form>}
    </Reveal>
  </main>;
}

const TRACK_STEPS = ['Order placed', 'Packed', 'Handed to courier', 'Out for delivery', 'Delivered'];

export function TrackOrderPage() {
  const orders = allOrders(useStore((state) => state.orders));
  const [values, setValues] = useState({ order: '', email: '' });
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const submit = (event) => {
    event.preventDefault();
    const found = {};
    if (!values.order.trim()) found.order = 'Enter your order number.';
    if (!EMAIL_PATTERN.test(values.email.trim())) found.email = 'Enter the email address used for the order.';
    setErrors(found);
    if (Object.keys(found).length) { window.setTimeout(() => document.querySelector(`[name="${Object.keys(found)[0]}"]`)?.focus(), 0); return; }
    const order = orders.find((entry) => entry.id.toLowerCase() === values.order.trim().toLowerCase());
    setResult({ id: values.order.trim(), order });
  };
  // Only the sample orders have tracking stages. An order placed in this demo has not been handed to anyone.
  const step = result?.order?.sample ? (result.order.status.startsWith('Delivered') ? 4 : 2) : 0;
  return <main id="main-content" className="ov-page ov-policy ov-info">
    <PageHead title="Track an order" intro="Enter an order number to see how tracking will look once ordering opens." />
    <DemoNotice>There is no live courier connection. The result below is always a sample. Try {orders[0]?.id}.</DemoNotice>
    <div className="ov-policy-body">
      <InfoSection title="How tracking will work">
        <p>When ordering opens, every order will receive a number. Enter that number and the email address used for the order below to see where your parcel is.</p>
        <p>An order moves through five stages:</p>
        <ol className="ov-info-steps">{TRACK_STEPS.map((label) => <li key={label}>{label}</li>)}</ol>
      </InfoSection>
    </div>
    <Reveal as="section" className="ov-info-formblock" aria-labelledby="ov-track-form-title">
      <h2 id="ov-track-form-title">Look up a sample order</h2>
      <form className="ov-form" onSubmit={submit} noValidate>
        <Field label="Order number" name="order" value={values.order} error={errors.order} onChange={(event) => setValues({ ...values, order: event.target.value })} />
        <Field label="Email" name="email" type="email" autoComplete="email" value={values.email} error={errors.email} onChange={(event) => setValues({ ...values, email: event.target.value })} />
        <button type="submit" className="ov-button ov-button-dark">Show sample tracking</button>
      </form>
      {result && <section className="ov-track" aria-live="polite"><h3>Sample result for {result.id}</h3>
        {result.order ? <><p>{orderSummary(result.order).lines.length} {orderSummary(result.order).lines.length === 1 ? 'item' : 'items'} · {result.order.status}</p>
          <ol className="ov-steps">{TRACK_STEPS.map((label, index) => <li key={label} className={index <= step ? 'is-done' : ''}>{label}{index <= step && <span className="ov-sr-only"> (complete)</span>}</li>)}</ol></>
          : <p>No order with that number exists in this preview. A real store would look it up with the courier.</p>}
      </section>}
    </Reveal>
    <div className="ov-policy-body">
      <InfoSection title="Need help with an order?">
        <p>Read <Link to="/pages/shipping">Shipping &amp; delivery</Link> or the <Link to="/faq">FAQ</Link>, or send us a message on the <Link to="/contact">Contact</Link> page.</p>
      </InfoSection>
    </div>
  </main>;
}
