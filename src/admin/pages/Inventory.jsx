/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useMemo, useState } from 'react';
import { useAction, useAdmin, useLoad, useNotice } from '../hooks.js';
import { newOpKey, parseCount, shortId } from '../helpers.js';
import { Badge, Button, Card, CheckInput, DateText, LoadState, NoticeSlot, PageHeader, SelectInput, TableWrap, TextInput } from '../ui.jsx';

const one = (value) => (Array.isArray(value) ? value[0] : value) || null;
const optionText = (v) => [v.color_name, v.size_label].filter(Boolean).join(' / ') || '—';

function MovementHistory({ variantId }) {
  const { gateway } = useAdmin();
  const history = useLoad(() => gateway.query((db) => db.from('inventory_movements')
    .select('id, kind, delta_on_hand, delta_reserved, reason, order_id, actor_id, op_key, created_at').eq('variant_id', variantId).order('created_at', { ascending: false }).limit(50)), [variantId]);
  const rows = history.data || [];
  return (
    <>
      <h3>Movement history</h3>
      <LoadState loading={history.loading} error={history.error} data={history.data} onRetry={history.reload} empty={history.data && rows.length === 0} emptyText="No stock movements recorded yet.">
        <TableWrap label="Stock movements">
          <table className="ovad-table">
            <thead><tr><th scope="col">When</th><th scope="col">Type</th><th scope="col">On hand</th><th scope="col">Reserved</th><th scope="col">Reason</th><th scope="col">By</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><DateText value={row.created_at} /></td>
                  <td>{row.kind.replace(/_/g, ' ')}</td>
                  <td>{row.delta_on_hand > 0 ? `+${row.delta_on_hand}` : row.delta_on_hand}</td>
                  <td>{row.delta_reserved > 0 ? `+${row.delta_reserved}` : row.delta_reserved}</td>
                  <td>{row.reason || '—'}</td>
                  <td>{row.actor_id ? shortId(row.actor_id) : 'system'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </LoadState>
    </>
  );
}

function CountPanel({ row, onChanged, onClose }) {
  const { gateway } = useAdmin();
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const inv = row.inventory;
  const [mode, setMode] = useState('set');
  const [quantity, setQuantity] = useState(String(inv.on_hand));
  const [reason, setReason] = useState('');
  const [verify, setVerify] = useState(true);
  const [opKey, setOpKey] = useState(() => newOpKey());
  const [threshold, setThreshold] = useState(String(inv.low_stock_threshold));
  const [errors, setErrors] = useState({});

  const submit = async (event) => {
    event.preventDefault();
    const next = {};
    const qty = parseCount(quantity, { allowNegative: mode === 'delta', min: mode === 'delta' ? -1000000 : 0 });
    if (!qty.ok) next.quantity = qty.reason;
    if (reason.trim().length < 3) next.reason = 'Give a reason of at least 3 characters (for example “Counted shelf 2”).';
    setErrors(next);
    if (Object.keys(next).length) { notice.fail(new Error('Fix the highlighted fields.')); return; }
    const result = await run(
      () => gateway.rpc('admin_adjust_inventory', { p_variant_id: row.id, p_mode: mode, p_quantity: qty.value, p_reason: reason.trim(), p_op_key: opKey, p_verify: mode === 'set' ? true : verify }),
      (data) => (data?.replayed ? 'This count had already been recorded; nothing changed.' : `Recorded. On hand is now ${data.on_hand}, reserved ${data.reserved}.`),
    );
    if (result.ok) { setOpKey(newOpKey()); setReason(''); onChanged(); }
  };

  const saveThreshold = async (event) => {
    event.preventDefault();
    const value = parseCount(threshold, { max: 100000 });
    if (!value.ok) { setErrors({ threshold: value.reason }); notice.fail(new Error('Fix the highlighted fields.')); return; }
    setErrors({});
    const result = await run(() => gateway.rpc('admin_set_low_stock_threshold', { p_variant_id: row.id, p_threshold: value.value }), 'Low-stock threshold saved.');
    if (result.ok) onChanged();
  };

  return (
    <Card title={`${row.product?.name || 'Product'} · ${row.sku}`} actions={<Button onClick={onClose}>Close</Button>}>
      <p className="ovad-row">
        <Badge tone={inv.stock_verified ? 'ok' : 'warn'}>{inv.stock_verified ? 'Stock confirmed' : 'Stock not counted yet'}</Badge>
        <span>On hand {inv.on_hand}</span><span>Reserved {inv.reserved}</span><strong>Available {inv.on_hand - inv.reserved}</strong>
        {inv.verified_at ? <small>Last confirmed <DateText value={inv.verified_at} /></small> : null}
      </p>
      <p className="ovad-note">Unknown stock is not zero and not unlimited. A variant can only be sold once you have counted it and confirmed the count here.</p>
      <form className="ovad-form ovad-form-grid" onSubmit={submit} aria-label="Record a stock count">
        <SelectInput label="What are you recording?" value={mode} onChange={(value) => { setMode(value); setQuantity(value === 'set' ? String(inv.on_hand) : '0'); }}
          options={[{ value: 'set', label: 'A confirmed count (the exact number on hand)' }, { value: 'delta', label: 'An adjustment (add or remove some)' }]} />
        <TextInput label={mode === 'set' ? 'Counted quantity' : 'Change (+ or −)'} value={quantity} onChange={setQuantity} error={errors.quantity} inputMode="numeric" required />
        {mode === 'delta' ? <CheckInput label="Also mark the stock as confirmed" checked={verify} onChange={setVerify} /> : null}
        <TextInput label="Reason (required)" value={reason} onChange={setReason} error={errors.reason} wide maxLength={300} required />
        <div className="ovad-field-wide"><NoticeSlot notice={notice.notice} /></div>
        <div className="ovad-row ovad-field-wide"><Button type="submit" tone="primary" busy={busy}>{mode === 'set' ? 'Confirm count' : 'Record adjustment'}</Button></div>
      </form>
      <form className="ovad-form ovad-filters" onSubmit={saveThreshold} aria-label="Low-stock threshold">
        <TextInput label="Low-stock threshold" value={threshold} onChange={setThreshold} error={errors.threshold} inputMode="numeric" hint="Shown on the dashboard when available stock is at or below this number." />
        <Button type="submit" busy={busy}>Save threshold</Button>
      </form>
      <MovementHistory variantId={row.id} />
    </Card>
  );
}

export default function Inventory() {
  const { gateway } = useAdmin();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const list = useLoad(() => gateway.query((db) => db.from('product_variants')
    .select('id, sku, color_name, size_label, active, product:products(name, slug, status), inventory(on_hand, reserved, low_stock_threshold, stock_verified, verified_at)')
    .order('sku').limit(1000)), []);

  const rows = useMemo(() => (list.data || []).map((v) => ({ ...v, product: one(v.product), inventory: one(v.inventory) })).filter((v) => v.inventory), [list.data]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((v) => (!needle || v.sku.toLowerCase().includes(needle) || (v.product?.name || '').toLowerCase().includes(needle))
      && (filter === '' || (filter === 'unverified' && !v.inventory.stock_verified) || (filter === 'low' && v.inventory.stock_verified && v.inventory.on_hand - v.inventory.reserved <= v.inventory.low_stock_threshold)));
  }, [rows, search, filter]);
  const selected = rows.find((v) => v.id === selectedId);

  return (
    <>
      <PageHeader title="Inventory" lead="Count stock, then confirm it. Every change needs a reason and is kept in the movement history." />
      {selected ? <CountPanel key={selected.id} row={selected} onChanged={list.reload} onClose={() => setSelectedId(null)} /> : null}
      <Card>
        <div className="ovad-filters">
          <TextInput label="Search SKU or product" value={search} onChange={setSearch} type="search" />
          <SelectInput label="Show" value={filter} onChange={setFilter} options={[{ value: '', label: 'All variants' }, { value: 'unverified', label: 'Not counted yet' }, { value: 'low', label: 'Low stock' }]} />
        </div>
        <LoadState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} empty={list.data && visible.length === 0} emptyText={rows.length ? 'No variant matches this filter.' : 'No variants yet. Add variants to a product first.'}>
          <TableWrap label="Inventory">
            <table className="ovad-table">
              <thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col">Option</th><th scope="col">On hand</th><th scope="col">Reserved</th><th scope="col">Available</th><th scope="col">Counted</th><th scope="col"><span className="ovad-sr">Actions</span></th></tr></thead>
              <tbody>
                {visible.map((v) => (
                  <tr key={v.id}>
                    <td>{v.product?.name || '—'}{!v.active ? <> <Badge tone="muted">off</Badge></> : null}</td>
                    <td>{v.sku}</td>
                    <td>{optionText(v)}</td>
                    <td>{v.inventory.stock_verified ? v.inventory.on_hand : <span title="Not counted yet">?</span>}</td>
                    <td>{v.inventory.reserved}</td>
                    <td>{v.inventory.stock_verified ? v.inventory.on_hand - v.inventory.reserved : '?'}</td>
                    <td>{v.inventory.stock_verified ? <Badge tone="ok">confirmed</Badge> : <Badge tone="warn">not counted</Badge>}</td>
                    <td><Button onClick={() => setSelectedId(v.id)} aria-label={`Count ${v.sku}`}>Count</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </LoadState>
      </Card>
    </>
  );
}
