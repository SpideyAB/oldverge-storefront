import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, validateEmail } from '../../lib/auth.js';
import { callFunction } from '../../lib/api.js';
import { Field, InfoSection, PageHead } from '../../components/ui.jsx';
import Reveal from '../../components/Reveal.jsx';
import { OrdersList } from './AccountPages.jsx';
import OrderSummaryView from './OrderSummaryView.jsx';
import { describeContactFailure, describeLookupFailure, extractFromLink, parseTrackInput, splitName, validateReturnRequest } from './helpers.js';
import { ErrorSummary, FormMessage, GuestOrderNotice, useForm } from './shared.jsx';

export function TrackOrderPage() {
  const status = useAuth((state) => state.status);
  const init = useAuth((state) => state.init);
  const location = useLocation();
  const navigate = useNavigate();
  const form = useForm({ orderNumber: '', accessCode: '' });
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState(null);
  const [failure, setFailure] = useState(null);
  const [page, setPage] = useState(1);
  const requestId = useRef(0);
  const headingRef = useRef(null);
  const consumedHash = useRef(false);

  useEffect(() => { init(); }, [init]);

  const lookup = async (orderNumber, accessCode) => {
    const id = requestId.current + 1;
    requestId.current = id;
    setBusy(true);
    setFailure(null);
    setOrder(null);
    const result = await callFunction('order-status', { order_number: orderNumber, access_token: accessCode });
    if (id !== requestId.current) return;
    setBusy(false);
    if (result.ok && result.data?.order) {
      setOrder(result.data.order);
      window.setTimeout(() => headingRef.current?.focus(), 0);
    } else {
      setFailure(describeLookupFailure(result));
    }
  };

  // A confirmation link ends in #o=<order number>&t=<access code>. Use it once, then remove it from the address bar.
  useEffect(() => {
    if (consumedHash.current || !location.hash) return;
    const found = extractFromLink(location.hash);
    if (!found) return;
    consumedHash.current = true;
    const parsed = parseTrackInput(found.orderNumber, found.accessCode);
    form.setValues({ orderNumber: parsed.orderNumber, accessCode: '' });
    navigate(`${location.pathname}${location.search}`, { replace: true });
    if (parsed.ok) lookup(parsed.orderNumber, parsed.accessCode); else form.fail(parsed.errors);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the hash present on arrival
  }, [location.hash]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const parsed = parseTrackInput(form.values.orderNumber, form.values.accessCode);
    if (form.fail(parsed.errors)) return;
    form.setValues({ orderNumber: parsed.orderNumber, accessCode: form.values.accessCode });
    await lookup(parsed.orderNumber, parsed.accessCode);
  };

  return <main id="main-content" className="ov-page ov-policy ov-info">
    <PageHead title="Track an order" intro="Enter the order number and access code from your order confirmation." />
    <div className="ov-policy-body">
      <InfoSection title="Find your order">
        <p>You can also paste the whole link from your confirmation into either box. An order number or an email address on its own cannot open an order.</p>
        <p>Tracking details are recorded by the store when it ships your order. This page is not a live courier feed.</p>
      </InfoSection>
    </div>
    <Reveal as="section" className="ov-info-formblock" aria-labelledby="ov-track-form-title">
      <h2 id="ov-track-form-title">Look up an order</h2>
      <form className="ov-form" onSubmit={submit} noValidate aria-busy={busy}>
        <ErrorSummary errors={form.errors} />
        <Field label="Order number" autoComplete="off" autoCapitalize="characters" spellCheck="false" hint="For example OV-261019-1A2B3C4D" {...form.bind('orderNumber')} />
        <Field label="Access code" autoComplete="off" spellCheck="false" {...form.bind('accessCode')} />
        <FormMessage>{failure?.message}</FormMessage>
        <button type="submit" className="ov-button ov-button-dark" disabled={busy}>{busy ? 'Looking up…' : 'Show my order'}</button>
      </form>
      <div aria-live="polite">
        {busy && <p className="ov-note" role="status">Looking up your order…</p>}
        {order && <div className="ov-track">
          <h3 ref={headingRef} tabIndex={-1}>Your order</h3>
          <OrderSummaryView order={order} />
        </div>}
      </div>
    </Reveal>
    {status === 'signed-in' && <section aria-labelledby="ov-track-mine">
      <h2 id="ov-track-mine">Your orders</h2>
      <OrdersList page={page} onPage={setPage} heading="Your orders" />
    </section>}
    <GuestOrderNotice />
    <div className="ov-policy-body">
      <InfoSection title="Need help with an order?">
        <p>Read the <Link to="/faq">FAQ</Link> or send a message from the <Link to="/contact">Contact</Link> page.</p>
      </InfoSection>
    </div>
  </main>;
}

export function ReturnsPage() {
  const user = useAuth((state) => state.user);
  const init = useAuth((state) => state.init);
  const form = useForm({ name: '', email: '', order_number: '', message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [sentFor, setSentFor] = useState('');

  useEffect(() => { init(); }, [init]);
  const setValues = form.setValues;
  useEffect(() => {
    if (!user) return;
    setValues((current) => ({ ...current, email: current.email || user.email, name: current.name || user.fullName }));
  }, [user, setValues]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setProblem('');
    const found = validateReturnRequest(form.values, validateEmail(form.values.email));
    if (form.fail(found)) return;
    const { first, last } = splitName(form.values.name);
    const orderNumber = form.values.order_number.trim().toUpperCase();
    setBusy(true);
    const result = await callFunction('submit-contact', {
      kind: 'return_request',
      first_name: first,
      last_name: last,
      email: form.values.email.trim(),
      order_number: orderNumber,
      message: form.values.message.trim(),
      website: form.values.website, // honeypot: people never see it, so it stays empty
    });
    setBusy(false);
    if (result.ok) { setSentFor(orderNumber); form.setValues({ name: '', email: '', order_number: '', message: '', website: '' }); return; }
    setProblem(describeContactFailure(result));
  };

  return <main id="main-content" className="ov-page ov-policy ov-info">
    <PageHead title="Returns & exchanges" intro="Send the team a request about an order you have received." />
    <div className="ov-policy-body">
      <InfoSection title="What this form does">
        <p>It saves your request for the OLDVERGE team to review. No email is sent automatically, and sending a request does not mean a return, exchange or refund has been approved.</p>
        <p>Read the <Link to="/refund-policy">Returns &amp; Refunds policy</Link> for the current terms.</p>
      </InfoSection>
    </div>
    <Reveal as="section" className="ov-info-formblock" aria-labelledby="ov-return-form-title">
      <h2 id="ov-return-form-title">Request a return or exchange</h2>
      {sentFor
        ? <div className="ov-form-done" role="status">
          <h3>Your request was saved</h3>
          <p>Your request about order {sentFor} was saved for the team to review. We have not sent a confirmation email, and nothing has been approved yet.</p>
          <button type="button" className="ov-button ov-button-dark" onClick={() => setSentFor('')}>Send another request</button>
        </div>
        : <form className="ov-form" onSubmit={submit} noValidate aria-busy={busy}>
          <ErrorSummary errors={form.errors} />
          <Field label="Your name" autoComplete="name" maxLength={160} {...form.bind('name')} />
          <Field label="Email used for the order" type="email" autoComplete="email" {...form.bind('email')} />
          <Field label="Order number" autoComplete="off" autoCapitalize="characters" spellCheck="false" hint="For example OV-261019-1A2B3C4D" {...form.bind('order_number')} />
          <Field label="Which item, and what would you like to do? Why?" as="textarea" maxLength={4000} {...form.bind('message')} />
          <div className="ov-sr-only" aria-hidden="true">
            <label>Leave this field empty<input type="text" name="website" tabIndex={-1} autoComplete="off" value={form.values.website} onChange={form.bind('website').onChange} /></label>
          </div>
          <FormMessage>{problem}</FormMessage>
          <button type="submit" className="ov-button ov-button-dark" disabled={busy}>{busy ? 'Saving…' : 'Save my request'}</button>
        </form>}
    </Reveal>
  </main>;
}
