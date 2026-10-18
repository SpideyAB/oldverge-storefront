/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAction, useAdmin, useLoad, useNotice } from '../hooks.js';
import { NEXT_FULFILMENT, RETURN_NEXT, canCancel, canRequestRefund, parsePkr, refundCeiling, validateHttpsUrl } from '../helpers.js';
import { Badge, Button, Card, CheckInput, DateText, Definition, LoadState, Money, NoticeSlot, PageHeader, Pager, SelectInput, StatusBadge, TableWrap, TextArea, TextInput, useConfirm } from '../ui.jsx';

const PAGE = 25;
const FULFILMENT = ['unfulfilled', 'processing', 'shipped', 'delivered', 'cancelled'];
const PAYMENT = ['unpaid', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded'];
const opt = (list, all) => [{ value: '', label: all }, ...list.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }))];

export function OrdersList() {
  const { gateway } = useAdmin();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const fulfilment = params.get('fulfilment') || '';
  const payment = params.get('payment') || '';
  const attention = params.get('attention') === '1';
  const hideTest = params.get('test') === '0';
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const [draft, setDraft] = useState(q);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) { if (value === '' || value === null || value === false) next.delete(key); else next.set(key, String(value)); }
    if (!('offset' in changes)) next.delete('offset');
    setParams(next);
  };

  const list = useLoad(() => gateway.rpc('admin_list_orders', {
    p_search: q || null, p_fulfilment: fulfilment || null, p_payment: payment || null, p_attention: attention ? true : null,
    p_include_test: !hideTest, p_limit: PAGE, p_offset: offset,
  }), [q, fulfilment, payment, attention, hideTest, offset]);
  const rows = list.data?.rows || [];

  return (
    <>
      <PageHeader title="Orders" lead="Search by order number, customer name or email." />
      <Card>
        <form className="ovad-filters" onSubmit={(event) => { event.preventDefault(); update({ q: draft.trim() }); }}>
          <TextInput label="Search" type="search" value={draft} onChange={setDraft} />
          <SelectInput label="Fulfilment" value={fulfilment} onChange={(value) => update({ fulfilment: value })} options={opt(FULFILMENT, 'Any fulfilment')} />
          <SelectInput label="Payment" value={payment} onChange={(value) => update({ payment: value })} options={opt(PAYMENT, 'Any payment')} />
          <CheckInput label="Needs attention only" checked={attention} onChange={(value) => update({ attention: value ? '1' : '' })} />
          <CheckInput label="Hide test orders" checked={hideTest} onChange={(value) => update({ test: value ? '0' : '' })} />
          <Button type="submit" tone="primary">Search</Button>
        </form>
        <LoadState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} empty={list.data && rows.length === 0} emptyText="No orders match.">
          <TableWrap label="Orders">
            <table className="ovad-table">
              <thead><tr><th scope="col">Order</th><th scope="col">Placed</th><th scope="col">Customer</th><th scope="col">Items</th><th scope="col">Total</th><th scope="col">Payment</th><th scope="col">Fulfilment</th><th scope="col">Flags</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><Link to={`/admin/orders/${row.id}`}>{row.order_number}</Link></td>
                    <td><DateText value={row.placed_at} /></td>
                    <td>{row.customer_name}<br /><small>{row.customer_email}</small></td>
                    <td>{row.item_count}</td>
                    <td><Money value={row.total_pkr} /></td>
                    <td><StatusBadge value={row.payment_status} /><br /><small>{row.payment_method_label}</small></td>
                    <td><StatusBadge value={row.fulfilment_status} /></td>
                    <td>{row.needs_attention ? <Badge tone="bad">attention</Badge> : null} {row.is_test ? <Badge tone="muted">test</Badge> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {list.data ? <Pager offset={offset} limit={PAGE} total={Number(list.data.total)} busy={list.loading} onChange={(value) => update({ offset: value || '' })} /> : null}
        </LoadState>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- order detail actions
function ActionBox({ title, children }) {
  return <div className="ovad-actionbox"><h3>{title}</h3>{children}</div>;
}

function ShipmentForm({ order, call, busy }) {
  const [carrier, setCarrier] = useState('');
  const [number, setNumber] = useState('');
  const [url, setUrl] = useState('');
  const [mark, setMark] = useState(['unfulfilled', 'processing'].includes(order.fulfilment_status));
  const [errors, setErrors] = useState({});
  const submit = (event) => {
    event.preventDefault();
    const next = {};
    if (!carrier.trim() || carrier.trim().length > 80) next.carrier = 'Carrier: 1 to 80 characters.';
    if (!number.trim() || number.trim().length > 80) next.number = 'Tracking number: 1 to 80 characters.';
    const link = validateHttpsUrl(url, { label: 'Tracking link' });
    if (!link.ok) next.url = link.reason;
    setErrors(next);
    if (Object.keys(next).length) return;
    call('admin_record_shipment', { p_order_id: order.id, p_carrier: carrier.trim(), p_tracking_number: number.trim(), p_tracking_url: link.value, p_mark_shipped: mark }, 'Shipment recorded.');
  };
  return (
    <ActionBox title="Record a shipment (manual record)">
      <p className="ovad-note">This only saves what you type. OLDVERGE does not book a courier or fetch live tracking, and the customer sees these details.</p>
      <form className="ovad-form ovad-form-grid" onSubmit={submit}>
        <TextInput label="Carrier" value={carrier} onChange={setCarrier} error={errors.carrier} required />
        <TextInput label="Tracking number" value={number} onChange={setNumber} error={errors.number} required />
        <TextInput label="Tracking link (optional, https)" value={url} onChange={setUrl} error={errors.url} wide />
        {['unfulfilled', 'processing'].includes(order.fulfilment_status) ? <CheckInput label="Also mark the order as shipped" checked={mark} onChange={setMark} /> : null}
        <div className="ovad-row ovad-field-wide"><Button type="submit" busy={busy}>Save shipment</Button></div>
      </form>
    </ActionBox>
  );
}

function NoteForm({ label, buttonLabel, min, onSubmit, busy, hint }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return (
    <form className="ovad-form" onSubmit={(event) => {
      event.preventDefault();
      if (text.trim().length < min) { setError(`Write at least ${min} character${min === 1 ? '' : 's'}.`); return; }
      setError('');
      onSubmit(text.trim(), () => setText(''));
    }}>
      <TextArea label={label} value={text} onChange={setText} error={error} rows={2} maxLength={1900} hint={hint} />
      <div className="ovad-row"><Button type="submit" busy={busy}>{buttonLabel}</Button></div>
    </form>
  );
}

function ReturnForm({ order, items, call, busy }) {
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState({});
  const [error, setError] = useState('');
  const submit = (event) => {
    event.preventDefault();
    const lines = items.map((item) => ({ order_item_id: item.id, quantity: Number(qty[item.id] || 0) })).filter((l) => l.quantity > 0);
    if (!reason.trim()) { setError('Give a reason.'); return; }
    if (!lines.length) { setError('Choose at least one item and quantity.'); return; }
    setError('');
    call('admin_create_return', { p_order_id: order.id, p_reason: reason.trim(), p_items: lines }, 'Return opened.', () => { setReason(''); setQty({}); });
  };
  return (
    <ActionBox title="Open a return">
      <form className="ovad-form ovad-form-grid" onSubmit={submit}>
        {items.map((item) => (
          <TextInput key={item.id} label={`${item.product_name} ${item.size || ''} (bought ${item.quantity})`} value={qty[item.id] ?? ''} onChange={(value) => setQty((q) => ({ ...q, [item.id]: value.replace(/\D/g, '').slice(0, 2) }))} inputMode="numeric" placeholder="0" />
        ))}
        <TextArea label="Reason" value={reason} onChange={setReason} rows={2} maxLength={500} error={error} />
        <div className="ovad-row ovad-field-wide"><Button type="submit" busy={busy}>Open return</Button></div>
      </form>
    </ActionBox>
  );
}

function RefundForm({ order, refunds, returns, call, busy }) {
  const ceiling = refundCeiling(order, refunds);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [returnId, setReturnId] = useState('');
  const [errors, setErrors] = useState({});
  const submit = (event) => {
    event.preventDefault();
    const next = {};
    const value = parsePkr(amount, { min: 1, max: ceiling });
    if (!value.ok) next.amount = ceiling === 0 ? 'Nothing is left to refund.' : value.reason;
    if (note.trim().length < 3) next.note = 'Write a note of at least 3 characters.';
    setErrors(next);
    if (Object.keys(next).length) return;
    call('admin_request_refund', { p_order_id: order.id, p_amount_pkr: value.value, p_note: note.trim(), p_return_id: returnId || null }, 'Refund record created. It is not a refund until you confirm the money was returned.', () => { setAmount(''); setNote(''); });
  };
  return (
    <ActionBox title="Request a refund record">
      <p className="ovad-note"><strong>A refund record is not a refund.</strong> Nothing is paid back by saving it. Return the money yourself, then confirm it below. Left to refund: <Money value={ceiling} />.</p>
      <form className="ovad-form ovad-form-grid" onSubmit={submit}>
        <TextInput label="Amount (PKR, whole rupees)" value={amount} onChange={setAmount} error={errors.amount} inputMode="numeric" required />
        {returns.length ? <SelectInput label="Linked return (optional)" value={returnId} onChange={setReturnId} options={[{ value: '', label: 'None' }, ...returns.map((r) => ({ value: r.return.id, label: `${r.return.status} — ${r.return.reason.slice(0, 40)}` }))]} /> : null}
        <TextArea label="Note" value={note} onChange={setNote} error={errors.note} rows={2} maxLength={500} />
        <div className="ovad-row ovad-field-wide"><Button type="submit" busy={busy} disabled={ceiling === 0}>Create refund record</Button></div>
      </form>
    </ActionBox>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const { gateway } = useAdmin();
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const [dialog, ask] = useConfirm();
  const detail = useLoad(() => gateway.rpc('admin_get_order', { p_order_id: id }), [id]);
  const d = detail.data;
  const order = d?.order;

  // One place that runs a database function, reports the result and reloads the order.
  const call = async (fn, args, success, after) => {
    const result = await run(() => gateway.rpc(fn, args), success);
    if (result.ok) { after?.(); detail.reload(); }
    return result;
  };

  const cancel = () => ask({
    title: `Cancel ${order.order_number}?`,
    body: <p>Reserved or committed stock goes back on sale. {['paid', 'partially_refunded'].includes(order.payment_status) ? 'This order is paid: it will be flagged “refund required”, and you must return the money yourself.' : 'The customer is told the order was cancelled.'} This cannot be undone.</p>,
    confirmLabel: 'Cancel order', danger: true, input: { label: 'Reason for cancelling (required)', required: true, min: 3, max: 300 },
    action: (reason) => call('admin_cancel_order', { p_order_id: order.id, p_reason: reason }, 'Order cancelled.'),
  });
  const markCod = () => ask({
    title: 'Record cash payment?', body: <p>Confirm the courier handed you the cash for {order.order_number} (<Money value={order.total_pkr} />). Only cash-on-delivery orders can be marked.</p>,
    confirmLabel: 'Record payment', action: () => call('admin_mark_cod_paid', { p_order_id: order.id }, 'Cash payment recorded.'),
  });
  const revoke = () => ask({
    title: 'Revoke guest access?', body: <p>Every link the customer was given to view this order stops working. Their account (if any) is not affected.</p>,
    confirmLabel: 'Revoke access', danger: true, action: () => call('admin_revoke_order_access', { p_order_id: order.id }, 'Guest links revoked.'),
  });
  const confirmRefund = (refund) => ask({
    title: `Confirm refund of PKR ${refund.amount_pkr}?`,
    body: <p>Only confirm if the money has really been returned to the customer. Confirming changes the order&apos;s payment state to refunded and tells the customer a refund was recorded.</p>,
    confirmLabel: 'Money was returned', danger: true, input: { label: 'How was it returned? (required)', required: true, min: 3, max: 300 },
    action: (text) => call('admin_confirm_refund', { p_refund_id: refund.id, p_note: text }, 'Refund confirmed.'),
  });
  const restock = (item) => ask({
    title: 'Return the item to stock?', body: <p>Only do this if the returned goods are in sellable condition. This adds {item.quantity} to the on-hand count and can only be done once.</p>,
    confirmLabel: 'Restock', action: () => call('admin_restock_return_item', { p_return_item_id: item.id }, 'Item restocked.'),
  });
  const next = order ? NEXT_FULFILMENT[order.fulfilment_status] : null;
  const blocked = Boolean(next && next !== 'delivered' && ['pending', 'failed'].includes(order.payment_status));
  const itemName = (itemId) => d?.items.find((i) => i.id === itemId)?.product_name || 'Item';

  return (
    <>
      <PageHeader title={order ? `Order ${order.order_number}` : 'Order'}><Link className="ovad-link" to="/admin/orders">All orders</Link></PageHeader>
      <NoticeSlot notice={notice.notice} />
      <LoadState loading={detail.loading} error={detail.error} data={d} onRetry={detail.reload}>
        {d ? (
          <>
            <Card title="Summary">
              <p className="ovad-row">
                <StatusBadge value={order.payment_status} /><StatusBadge value={order.fulfilment_status} />
                {order.needs_attention ? <Badge tone="bad">needs attention: {String(order.attention_reason || 'flagged').replace(/_/g, ' ')}</Badge> : null}
                {order.is_test ? <Badge tone="muted">test order</Badge> : null}
              </p>
              <div className="ovad-two">
                <Definition items={[
                  ['Placed', <DateText key="p" value={order.placed_at} />], ['Payment method', order.payment_method_label], ['Shipping method', order.shipping_method_label],
                  ['Stock', order.stock_state], ['Account', d.has_account ? 'Has an account' : 'Guest checkout'],
                  order.cancelled_at ? ['Cancelled', <><DateText key="c" value={order.cancelled_at} /> — {order.cancel_reason}</>] : null,
                ]} />
                <Definition items={[
                  ['Subtotal', <Money key="s" value={order.subtotal_pkr} />], ['Shipping', <Money key="h" value={order.shipping_pkr} />],
                  ['Tax', order.tax_status === 'not_calculated' ? 'Not calculated' : <Money key="t" value={order.tax_pkr} />], ['Total', <strong key="o"><Money value={order.total_pkr} /></strong>],
                ]} />
              </div>
            </Card>

            <Card title="Customer and delivery">
              <div className="ovad-two">
                <Definition items={[['Name', order.customer_name], ['Email', order.customer_email], ['Phone', order.customer_phone]]} />
                <Definition items={Object.entries(order.shipping_address || {}).filter(([, value]) => value !== null && value !== '').map(([key, value]) => [key.replace(/_/g, ' '), String(value)])} />
              </div>
              <Definition items={[
                ['Carrier (manual record)', order.tracking_carrier], ['Tracking number (manual record)', order.tracking_number],
                ['Tracking link', order.tracking_url ? <a key="u" className="ovad-link" href={order.tracking_url} target="_blank" rel="noopener noreferrer">{order.tracking_url}</a> : null],
              ]} />
            </Card>

            <Card title="Items">
              <TableWrap label="Order items">
                <table className="ovad-table">
                  <thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col">Option</th><th scope="col">Unit</th><th scope="col">Qty</th><th scope="col">Line</th></tr></thead>
                  <tbody>
                    {d.items.map((item) => (
                      <tr key={item.id}><td>{item.product_name}</td><td>{item.sku}</td><td>{[item.color, item.size].filter(Boolean).join(' / ') || '—'}</td><td><Money value={item.unit_price_pkr} /></td><td>{item.quantity}</td><td><Money value={item.line_total_pkr} /></td></tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>

            <Card title="Actions">
              <div className="ovad-actions-grid">
                {next && !blocked ? (
                  <ActionBox title="Fulfilment">
                    <NoteForm label={`Optional note for “${next}”`} buttonLabel={`Mark as ${next}`} min={0} busy={busy} hint="The customer can see this note." onSubmit={(text, reset) => call('admin_set_fulfilment', { p_order_id: order.id, p_to: next, p_note: text || null }, `Order is now ${next}.`, reset)} />
                  </ActionBox>
                ) : null}
                {blocked ? <p className="ovad-note">Payment is {order.payment_status}, so this order cannot move to {next} yet.</p> : null}
                {!['cancelled', 'delivered'].includes(order.fulfilment_status) ? <ShipmentForm order={order} call={call} busy={busy} /> : null}
                <ActionBox title="Payment and access">
                  <div className="ovad-row">
                    {order.payment_status === 'unpaid' && order.fulfilment_status !== 'cancelled' ? <Button busy={busy} onClick={markCod}>Mark cash on delivery as paid</Button> : null}
                    <Button busy={busy} onClick={revoke}>Revoke guest access</Button>
                    {canCancel(order) ? <Button tone="danger" busy={busy} onClick={cancel}>Cancel order</Button> : null}
                  </div>
                </ActionBox>
                {order.needs_attention ? (
                  <ActionBox title="Clear the attention flag">
                    <NoteForm label="What did you do about it? (required)" buttonLabel="Clear flag" min={3} busy={busy} onSubmit={(text, reset) => call('admin_clear_attention', { p_order_id: order.id, p_note: text }, 'Flag cleared.', reset)} />
                  </ActionBox>
                ) : null}
                <ActionBox title="Add a private note">
                  <NoteForm label="Note (only staff can see it)" buttonLabel="Add note" min={1} busy={busy} onSubmit={(text, reset) => call('admin_add_order_note', { p_order_id: order.id, p_note: text }, 'Note added.', reset)} />
                </ActionBox>
                <ReturnForm order={order} items={d.items} call={call} busy={busy} />
                {canRequestRefund(order) ? <RefundForm order={order} refunds={d.refunds} returns={d.returns} call={call} busy={busy} /> : null}
              </div>
            </Card>

            <Card title="Returns">
              {d.returns.length === 0 ? <p className="ovad-empty">No returns.</p> : d.returns.map(({ return: r, items }) => (
                <div key={r.id} className="ovad-actionbox">
                  <p className="ovad-row"><StatusBadge value={r.status} /> <span>{r.reason}</span> <small><DateText value={r.created_at} /></small></p>
                  <ul className="ovad-plain-list">
                    {items.map((item) => (
                      <li key={item.id}>{itemName(item.order_item_id)} × {item.quantity}{' '}
                        {item.restocked_at ? <Badge tone="ok">restocked</Badge> : r.status === 'received' ? <Button busy={busy} onClick={() => restock(item)}>Restock</Button> : null}
                      </li>
                    ))}
                  </ul>
                  <div className="ovad-row">
                    {(RETURN_NEXT[r.status] || []).map((to) => (
                      <Button key={to} busy={busy} tone={to === 'rejected' ? 'danger' : 'secondary'} onClick={() => call('admin_set_return_status', { p_return_id: r.id, p_to: to, p_note: null }, `Return ${to}.`)}>Mark {to}</Button>
                    ))}
                  </div>
                </div>
              ))}
            </Card>

            <Card title="Refunds">
              <p className="ovad-note">A refund record is not a refund. It becomes one only when you confirm that the money was returned.</p>
              {d.refunds.length === 0 ? <p className="ovad-empty">No refund records.</p> : (
                <TableWrap label="Refunds">
                  <table className="ovad-table">
                    <thead><tr><th scope="col">Created</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Note</th><th scope="col"><span className="ovad-sr">Actions</span></th></tr></thead>
                    <tbody>
                      {d.refunds.map((refund) => (
                        <tr key={refund.id}>
                          <td><DateText value={refund.created_at} /></td><td><Money value={refund.amount_pkr} /></td>
                          <td>{refund.status === 'requested' ? <Badge tone="warn">requested — money not yet returned</Badge> : <StatusBadge value={refund.status} />}</td>
                          <td>{refund.note}</td>
                          <td>{refund.status === 'requested' && refund.method === 'manual' ? <Button busy={busy} onClick={() => confirmRefund(refund)}>Confirm money returned</Button> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>

            {d.payment_attempts.length ? (
              <Card title="Payment attempts">
                <TableWrap label="Payment attempts">
                  <table className="ovad-table"><thead><tr><th scope="col">When</th><th scope="col">Provider</th><th scope="col">Amount</th><th scope="col">Status</th></tr></thead>
                    <tbody>{d.payment_attempts.map((p) => <tr key={p.id}><td><DateText value={p.created_at} /></td><td>{p.provider}</td><td><Money value={p.amount_pkr} /></td><td><StatusBadge value={p.status} /></td></tr>)}</tbody></table>
                </TableWrap>
              </Card>
            ) : null}

            <Card title="Private notes">
              {d.notes.length === 0 ? <p className="ovad-empty">No notes.</p> : <ul className="ovad-plain-list">{d.notes.map((n) => <li key={n.id}><small><DateText value={n.created_at} /></small><br />{n.note}</li>)}</ul>}
            </Card>

            <Card title="History">
              <ol className="ovad-timeline">
                {d.events.map((e) => (
                  <li key={e.id}>
                    <small><DateText value={e.created_at} /> · {e.actor_kind}{e.visible_to_customer ? '' : ' · hidden from customer'}</small><br />
                    <strong>{e.kind.replace(/_/g, ' ')}</strong>{e.from_state || e.to_state ? ` (${e.from_state || '—'} → ${e.to_state || '—'})` : ''}{e.message ? ` — ${e.message}` : ''}
                  </li>
                ))}
              </ol>
            </Card>
          </>
        ) : null}
      </LoadState>
      {dialog}
    </>
  );
}
