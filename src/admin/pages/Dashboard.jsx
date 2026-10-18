/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin, useLoad } from '../hooks.js';
import { describeProblems } from '../errors.js';
import { defaultRange, validateRange } from '../helpers.js';
import { Badge, Button, Card, DateText, LoadState, Money, PageHeader, StatusBadge, TableWrap, TextInput } from '../ui.jsx';

function CountList({ counts, empty = 'None in this period.' }) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return <p className="ovad-empty">{empty}</p>;
  return (
    <ul className="ovad-plain-list">
      {entries.map(([name, count]) => <li key={name}><StatusBadge value={name} /> <strong>{count}</strong></li>)}
    </ul>
  );
}

function Readiness({ state }) {
  const ready = state.data?.ready === true;
  const problems = describeProblems(state.data?.problems);
  return (
    <Card title="Ordering readiness" actions={<Link className="ovad-link" to="/admin/settings">Open settings</Link>}>
      <LoadState loading={state.loading} error={state.error} data={state.data} onRetry={state.reload}>
        {state.data ? (
          <>
            <p><Badge tone={ready ? 'ok' : 'warn'}>{ready ? 'Ready to take orders' : 'Not ready to take orders'}</Badge></p>
            {problems.length ? (
              <ul className="ovad-problems">
                {problems.map((text) => <li key={text}>Fix: {text}.</li>)}
              </ul>
            ) : <p>Every readiness check passes. Ordering is still off until the owner turns it on in Settings.</p>}
          </>
        ) : null}
      </LoadState>
    </Card>
  );
}

export default function Dashboard() {
  const { gateway } = useAdmin();
  const [range, setRange] = useState(() => defaultRange(30));
  const [applied, setApplied] = useState(range);
  const [rangeError, setRangeError] = useState('');

  const stats = useLoad(async () => {
    const valid = validateRange(applied.from, applied.to);
    if (!valid.ok) throw new Error(valid.reason);
    return gateway.rpc('admin_dashboard_stats', { p_from: valid.from, p_to: valid.to });
  }, [applied.from, applied.to]);
  const attention = useLoad(() => gateway.rpc('admin_list_orders', { p_attention: true, p_include_test: true, p_limit: 10, p_offset: 0 }), []);
  const readiness = useLoad(() => gateway.rpc('admin_ordering_readiness'), []);
  const ordering = useLoad(() => gateway.query((db) => db.from('store_settings').select('value').eq('key', 'ordering_enabled').maybeSingle()), []);

  const apply = (event) => {
    event.preventDefault();
    const valid = validateRange(range.from, range.to);
    if (!valid.ok) { setRangeError(valid.reason); return; }
    setRangeError('');
    setApplied(range);
  };
  const preset = (days) => { const next = defaultRange(days); setRange(next); setApplied(next); setRangeError(''); };

  const s = stats.data;
  const orderingOn = ordering.data?.value === true;

  return (
    <>
      <PageHeader title="Dashboard" lead="A quick read of the store. Figures come straight from the database.">
        <Badge tone={orderingOn ? 'ok' : 'warn'}>{ordering.data ? (orderingOn ? 'Ordering is ON' : 'Ordering is OFF') : 'Ordering status loading'}</Badge>
      </PageHeader>

      <Card title="Period">
        <form className="ovad-filters" onSubmit={apply}>
          <TextInput label="From" type="date" value={range.from} onChange={(from) => setRange((r) => ({ ...r, from }))} error={rangeError} />
          <TextInput label="To" type="date" value={range.to} onChange={(to) => setRange((r) => ({ ...r, to }))} />
          <Button type="submit" tone="primary">Apply</Button>
          <Button onClick={() => preset(7)}>Last 7 days</Button>
          <Button onClick={() => preset(30)}>Last 30 days</Button>
          <Button onClick={() => preset(90)}>Last 90 days</Button>
        </form>
      </Card>

      <div className="ovad-grid">
        <Card title="Revenue and orders">
          <LoadState loading={stats.loading} error={stats.error} data={s} onRetry={stats.reload}>
            {s ? (
              <>
                <div className="ovad-stats">
                  <div><span>Revenue</span><strong><Money value={s.revenue_pkr} /></strong></div>
                  <div><span>Cash on delivery not yet collected</span><strong><Money value={s.awaiting_cod_pkr} /></strong></div>
                  <div><span>Orders placed</span><strong>{s.orders_total}</strong></div>
                </div>
                <p className="ovad-note">
                  Revenue counts real orders (test orders are left out) placed in this period that are paid or partly refunded and not cancelled,
                  minus refunds you have confirmed. Cash-on-delivery orders count only after you record the payment.
                  A refund record that is still only requested is not subtracted.
                </p>
              </>
            ) : null}
          </LoadState>
        </Card>

        <Card title="Orders by fulfilment">
          <LoadState loading={stats.loading} error={stats.error} data={s} onRetry={stats.reload}>{s ? <CountList counts={s.by_fulfilment} /> : null}</LoadState>
        </Card>
        <Card title="Orders by payment">
          <LoadState loading={stats.loading} error={stats.error} data={s} onRetry={stats.reload}>{s ? <CountList counts={s.by_payment} /> : null}</LoadState>
        </Card>

        <Card title="Needs your attention">
          <LoadState loading={stats.loading} error={stats.error} data={s} onRetry={stats.reload}>
            {s ? (
              <ul className="ovad-plain-list">
                <li><Link to="/admin/orders?attention=1">Orders needing attention</Link> <strong>{s.needs_attention}</strong></li>
                <li><Link to="/admin/messages">Unread messages</Link> <strong>{s.unread_messages}</strong></li>
                <li><Link to="/admin/operations">Failed notifications</Link> <strong>{s.failed_notifications}</strong></li>
              </ul>
            ) : null}
          </LoadState>
        </Card>

        <Readiness state={readiness} />
      </div>

      <Card title="Orders that need attention" actions={<Link className="ovad-link" to="/admin/orders?attention=1">See all</Link>}>
        <LoadState loading={attention.loading} error={attention.error} data={attention.data} onRetry={attention.reload} empty={attention.data && attention.data.rows.length === 0} emptyText="No orders are flagged.">
          {attention.data ? (
            <TableWrap label="Orders needing attention">
              <table className="ovad-table">
                <thead><tr><th scope="col">Order</th><th scope="col">Placed</th><th scope="col">Customer</th><th scope="col">Total</th><th scope="col">Why</th></tr></thead>
                <tbody>
                  {attention.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td><Link to={`/admin/orders/${row.id}`}>{row.order_number}</Link></td>
                      <td><DateText value={row.placed_at} /></td>
                      <td>{row.customer_name}</td>
                      <td><Money value={row.total_pkr} /></td>
                      <td>{row.attention_reason ? String(row.attention_reason).replace(/_/g, ' ') : 'Flagged'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : null}
        </LoadState>
      </Card>

      <Card title="Low stock" actions={<Link className="ovad-link" to="/admin/inventory">Inventory</Link>}>
        <LoadState loading={stats.loading} error={stats.error} data={s} onRetry={stats.reload} empty={s && s.low_stock.length === 0} emptyText="No published variant is at or below its low-stock threshold.">
          {s ? (
            <TableWrap label="Low stock variants">
              <table className="ovad-table">
                <thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col">Available</th><th scope="col">Threshold</th></tr></thead>
                <tbody>
                  {s.low_stock.map((row) => (
                    <tr key={row.variant_id}><td>{row.product}</td><td>{row.sku}</td><td>{row.available}</td><td>{row.threshold}</td></tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : null}
        </LoadState>
        <p className="ovad-note">Only variants whose stock you have counted and confirmed appear here. Uncounted stock is unknown, not zero.</p>
      </Card>
    </>
  );
}
