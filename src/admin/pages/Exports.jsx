/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useState } from 'react';
import { useAction, useAdmin, useNotice } from '../hooks.js';
import { defaultRange, validateRange } from '../helpers.js';
import { downloadCsv, toCsv } from '../csv.js';
import { Button, Card, NoticeSlot, PageHeader, SelectInput, TextInput } from '../ui.jsx';

export const ORDER_COLUMNS = [
  ['order_number', 'Order number'], ['placed_at', 'Placed at'], ['customer_name', 'Customer name'], ['customer_email', 'Customer email'], ['customer_phone', 'Customer phone'],
  ['city', 'City'], ['province', 'Province'], ['payment_method', 'Payment method'], ['payment_status', 'Payment status'], ['fulfilment_status', 'Fulfilment status'],
  ['subtotal_pkr', 'Subtotal PKR'], ['shipping_pkr', 'Shipping PKR'], ['total_pkr', 'Total PKR'], ['is_test', 'Test order'],
].map(([key, label]) => ({ key, label }));

const LIMITS = [500, 1000, 2500, 5000].map((value) => ({ value: String(value), label: `Up to ${value} orders` }));

export default function Exports() {
  const { gateway } = useAdmin();
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const [range, setRange] = useState(() => defaultRange(30));
  const [limit, setLimit] = useState('1000');
  const [error, setError] = useState('');

  const download = async (event) => {
    event.preventDefault();
    const valid = validateRange(range.from, range.to);
    if (!valid.ok) { setError(valid.reason); return; }
    setError('');
    const max = Math.min(5000, Number(limit) || 1000);
    await run(async () => {
      const rows = await gateway.rpc('admin_export_orders', { p_from: valid.from, p_to: valid.to, p_limit: max });
      const list = Array.isArray(rows) ? rows : [];
      downloadCsv(`oldverge-orders-${range.from}-to-${range.to}.csv`, toCsv(ORDER_COLUMNS, list));
      return list.length;
    }, (count) => (count >= max
      ? `Downloaded ${count} orders. That is the limit you chose, so there may be more in this period; narrow the dates or raise the limit.`
      : `Downloaded ${count} order${count === 1 ? '' : 's'}.`));
  };

  return (
    <>
      <PageHeader title="Exports" lead="Download orders as a CSV file for your accountant or spreadsheet." />
      <Card title="Orders (CSV)">
        <form className="ovad-form ovad-form-grid" onSubmit={download}>
          <TextInput label="From" type="date" value={range.from} onChange={(from) => setRange((r) => ({ ...r, from }))} error={error} />
          <TextInput label="To (included)" type="date" value={range.to} onChange={(to) => setRange((r) => ({ ...r, to }))} />
          <SelectInput label="Size" value={limit} onChange={setLimit} options={LIMITS} />
          <div className="ovad-field-wide"><NoticeSlot notice={notice.notice} /></div>
          <div className="ovad-row ovad-field-wide"><Button type="submit" tone="primary" busy={busy}>Download CSV</Button></div>
        </form>
        <p className="ovad-note">
          The file contains customers&apos; names, emails and phone numbers. Keep it private and delete it when you are done. Each export is recorded in the activity log.
          Cells that start with = + - @ are prefixed with a quote so spreadsheets do not run them as formulas. Test orders are included and marked.
        </p>
      </Card>
    </>
  );
}
