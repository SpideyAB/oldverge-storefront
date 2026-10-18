import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { EmptyState } from '../../components/ui.jsx';
import { fetchOrderByAccess, parseConfirmationHash } from '../../lib/checkout.js';
import OrderSummaryView from '../live/OrderSummaryView.jsx';

/**
 * Order confirmation for the Supabase backend. The order is READ BACK from the database with the capability in the
 * URL fragment (#o=<number>&t=<code>), so a refresh works and nothing here is a local fake. The fragment is never
 * sent to any server except in the request body of the lookup.
 */
export default function LiveConfirmationPage() {
  const { hash } = useLocation();
  const link = parseConfirmationHash(hash);
  const [state, setState] = useState({ status: link ? 'loading' : 'missing', order: null });
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!link) return;
    setState({ status: 'loading', order: null });
    const result = await fetchOrderByAccess(link.order, link.token);
    if (result.ok && result.data?.order) setState({ status: 'ready', order: result.data.order });
    else if (result.status === 404) setState({ status: 'notfound', order: null });
    else if (result.status === 429) setState({ status: 'limited', order: null });
    else setState({ status: 'error', order: null });
  }, [link?.order, link?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  if (state.status === 'missing') {
    return <main id="main-content" className="ov-page"><EmptyState title="No order to show." actions={<><Link to="/shop" className="ov-button ov-button-dark">Continue shopping</Link><Link to="/pages/track-order" className="ov-button ov-button-light">Track an order</Link></>}>Open the confirmation link you were given when you placed your order, or use Track an order with your order number and access code.</EmptyState></main>;
  }
  if (state.status === 'loading') return <main id="main-content" className="ov-backend-state" aria-busy="true"><p role="status">Loading your order…</p></main>;
  if (state.status !== 'ready') {
    const message = state.status === 'notfound' ? 'We could not find that order. Check the link or the access code.'
      : state.status === 'limited' ? 'Too many attempts. Please wait a minute and try again.' : 'We could not load your order right now. Your order is safe; please try again.';
    return <main id="main-content" className="ov-page"><EmptyState title="We could not show your order." actions={<>{state.status !== 'notfound' && <button type="button" className="ov-button ov-button-dark" onClick={load}>Try again</button>}<Link to="/pages/track-order" className="ov-button ov-button-light">Track an order</Link></>}>{message}</EmptyState></main>;
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setCopied(false); }
  };
  return <main id="main-content" className="ov-page ov-confirmation">
    <header className="ov-page-head"><p className="ov-eyebrow-dark">Order received</p><h1>Thank you. We have your order.</h1>
      <p className="ov-page-intro">Order number <strong>{state.order.order_number}</strong>. No confirmation email is sent automatically, so keep this page.</p></header>
    <section className="ov-note" aria-labelledby="oc-save">
      <h2 id="oc-save">Keep this link</h2>
      <p>This link is the key to your order. Anyone who has it can view the order, so do not share it publicly. You can also use your order number and the access code from the link on the Track an order page.</p>
      <button type="button" className="ov-button ov-button-light" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
    </section>
    <OrderSummaryView order={state.order} />
    <p><Link to="/shop" className="ov-button ov-button-dark">Continue shopping</Link></p>
  </main>;
}
