import { Link } from 'react-router-dom';
import { formatPrice } from '../../lib/money.js';
import { formatDate, formatDateTime, fulfilmentLabel, humaniseKind, paymentLabel, safeHttpUrl, safeSlug, taxLine } from './helpers.js';

const money = (value) => formatPrice(Number(value) || 0);

function AddressBlock({ address }) {
  if (!address || typeof address !== 'object') return null;
  const lines = [address.recipient, address.line1, address.line2, [address.city, address.province, address.postal_code].filter(Boolean).join(', '), address.country === 'PK' || !address.country ? 'Pakistan' : address.country];
  return <address>{lines.filter(Boolean).map((line, index) => <span key={`${index}-${line}`}>{index > 0 && <br />}{String(line)}</span>)}</address>;
}

function Tracking({ order }) {
  const carrier = order.tracking_carrier;
  const number = order.tracking_number;
  const url = safeHttpUrl(order.tracking_url);
  if (!carrier && !number && !url) {
    return <p>No tracking details have been recorded for this order yet.</p>;
  }
  return <>
    <p>{[carrier, number].filter(Boolean).join(' · ') || 'Tracking link recorded'}</p>
    {url && <p><a href={url} target="_blank" rel="noopener noreferrer" className="ov-text-link">Open tracking page<span className="ov-sr-only"> (opens in a new tab)</span></a></p>}
  </>;
}

/**
 * Renders the customer-safe order projection (public.order_projection, returned by the order-status function and
 * rebuilt from the orders table for signed-in customers). Everything is rendered as React text.
 */
export default function OrderSummaryView({ order }) {
  if (!order) return null;
  const items = Array.isArray(order.items) ? order.items : [];
  const events = Array.isArray(order.events) ? order.events : [];
  const tax = taxLine(order);
  const cancelled = order.fulfilment_status === 'cancelled';
  return <div className="ov-order-view">
    <section aria-labelledby="ov-order-heading">
      <h2 id="ov-order-heading">Order {order.order_number}</h2>
      <p>
        {order.placed_at && <>Placed {formatDate(order.placed_at)}. </>}
        <strong>{fulfilmentLabel(order.fulfilment_status)}</strong>
        {order.payment_status && <> · {paymentLabel(order.payment_status)}</>}
      </p>
      {cancelled && order.cancel_reason && <p className="ov-note">Reason recorded: {order.cancel_reason}</p>}
      {order.customer_name && <p className="ov-note">For {order.customer_name}{order.email_hint ? ` (${order.email_hint})` : ''}</p>}
    </section>

    <section aria-labelledby="ov-order-items">
      <h2 id="ov-order-items">Items</h2>
      {items.length ? <table className="ov-table">
        <caption className="ov-sr-only">Items in order {order.order_number}</caption>
        <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Total</th></tr></thead>
        <tbody>{items.map((item, index) => {
          const slug = safeSlug(item.product_slug);
          const details = [item.color, item.size].filter(Boolean).join(' · ');
          return <tr key={`${item.sku || item.product_slug}-${index}`}>
            <th scope="row">
              {slug ? <Link to={`/product/${slug}`}>{item.product_name}</Link> : item.product_name}
              <small className="ov-note"><br />{[details, `${money(item.unit_price_pkr)} each`].filter(Boolean).join(' · ')}</small>
            </th>
            <td>{Number(item.quantity) || 0}</td>
            <td>{money(item.line_total_pkr)}</td>
          </tr>;
        })}</tbody>
      </table> : <p className="ov-note">No items are listed for this order.</p>}
      <div className="ov-row"><span>Subtotal</span><strong>{money(order.subtotal_pkr)}</strong></div>
      <div className="ov-row"><span>Delivery{order.shipping_method ? ` (${order.shipping_method})` : ''}</span><strong>{money(order.shipping_pkr)}</strong></div>
      <div className="ov-row"><span>{tax.label}</span><strong>{tax.text || money(tax.amount)}</strong></div>
      <div className="ov-row ov-row-total"><span>Total</span><strong>{money(order.total_pkr)}</strong></div>
    </section>

    <section aria-labelledby="ov-order-delivery">
      <h2 id="ov-order-delivery">Delivery and payment</h2>
      <h3>Ship to</h3>
      <AddressBlock address={order.shipping_address} />
      <h3>Payment</h3>
      <p>{[order.payment_method, paymentLabel(order.payment_status)].filter(Boolean).join(' · ')}</p>
      <h3>Tracking</h3>
      <Tracking order={order} />
      <p className="ov-note">Tracking details are recorded by the store. This page is not a live courier feed.</p>
    </section>

    <section aria-labelledby="ov-order-events">
      <h2 id="ov-order-events">Order history</h2>
      {events.length ? <ol className="ov-steps">{events.map((event, index) => <li key={`${event.created_at}-${index}`} className="is-done">
        {event.message || humaniseKind(event.kind)}
        <small className="ov-note"> {formatDateTime(event.created_at)}</small>
      </li>)}</ol> : <p className="ov-note">No updates have been recorded yet.</p>}
    </section>
  </div>;
}
