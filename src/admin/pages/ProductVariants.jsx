/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAction, useAdmin, useLoad, useNotice } from '../hooks.js';
import { validateVariant } from '../helpers.js';
import { Badge, Button, Card, CheckInput, LoadState, Money, NoticeSlot, TableWrap, TextInput } from '../ui.jsx';

const blank = { sku: '', color_name: '', color_hex: '', size_label: '', price_pkr: '', sort_order: '0', active: true };
const toForm = (v) => ({
  sku: v.sku, color_name: v.color_name || '', color_hex: v.color_hex || '', size_label: v.size_label || '',
  price_pkr: String(v.price_pkr), sort_order: String(v.sort_order ?? 0), active: v.active,
});

function VariantForm({ productId, variant, onSaved, onCancel }) {
  const { gateway } = useAdmin();
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const [form, setForm] = useState(variant ? toForm(variant) : blank);
  const [errors, setErrors] = useState({});
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (event) => {
    event.preventDefault();
    const checked = validateVariant(form);
    setErrors(checked.errors);
    if (!checked.ok) { notice.fail(new Error('Fix the highlighted fields. Prices are whole rupees with no decimals.')); return; }
    const result = await run(
      () => gateway.query((db) => (variant
        ? db.from('product_variants').update(checked.value).eq('id', variant.id)
        : db.from('product_variants').insert({ ...checked.value, product_id: productId }))),
      variant ? 'Variant saved.' : 'Variant added. Count its stock in Inventory before selling it.',
    );
    if (result.ok) onSaved();
  };

  return (
    <form className="ovad-form ovad-form-grid ovad-subform" onSubmit={save} aria-label={variant ? `Edit variant ${variant.sku}` : 'Add variant'}>
      <TextInput label="SKU" value={form.sku} onChange={set('sku')} error={errors.sku} required hint="3 to 40 characters. Must be unique across the store." />
      <TextInput label="Colour name" value={form.color_name} onChange={set('color_name')} error={errors.color_name} />
      <TextInput label="Colour code" value={form.color_hex} onChange={set('color_hex')} error={errors.color_hex} placeholder="#30251F" hint="Optional, for the swatch." />
      <TextInput label="Size" value={form.size_label} onChange={set('size_label')} error={errors.size_label} />
      <TextInput label="Price (PKR, whole rupees)" value={form.price_pkr} onChange={set('price_pkr')} error={errors.price_pkr} inputMode="numeric" required />
      <TextInput label="Display order" value={form.sort_order} onChange={set('sort_order')} error={errors.sort_order} inputMode="numeric" />
      <CheckInput label="Active (can be shown and sold)" checked={form.active} onChange={set('active')} />
      <div className="ovad-field-wide"><NoticeSlot notice={notice.notice} /></div>
      <div className="ovad-row ovad-field-wide">
        <Button type="submit" tone="primary" busy={busy}>{variant ? 'Save variant' : 'Add variant'}</Button>
        <Button onClick={onCancel}>Close</Button>
      </div>
    </form>
  );
}

export default function ProductVariants({ product, onChanged }) {
  const { gateway } = useAdmin();
  const [editing, setEditing] = useState(null);
  const variants = useLoad(() => gateway.query((db) => db.from('product_variants')
    .select('id, sku, color_name, color_hex, size_label, price_pkr, active, sort_order').eq('product_id', product.id).order('sort_order').order('created_at')), [product.id]);

  const saved = () => { setEditing(null); variants.reload(); onChanged(); };
  const rows = variants.data || [];

  return (
    <Card title="Variants" actions={<Button onClick={() => setEditing('new')} disabled={editing === 'new'}>Add variant</Button>}>
      <p className="ovad-note">
        Each variant has its own SKU, price and stock. Variants cannot be deleted (orders refer to them); switch one off instead.
        Stock is counted in <Link to="/admin/inventory">Inventory</Link>.
      </p>
      {editing === 'new' ? <VariantForm productId={product.id} onSaved={saved} onCancel={() => setEditing(null)} /> : null}
      <LoadState loading={variants.loading} error={variants.error} data={variants.data} onRetry={variants.reload} empty={variants.data && rows.length === 0} emptyText="No variants yet. A product needs at least one active variant with a price.">
        <TableWrap label="Variants">
          <table className="ovad-table">
            <thead><tr><th scope="col">SKU</th><th scope="col">Colour</th><th scope="col">Size</th><th scope="col">Price</th><th scope="col">Active</th><th scope="col"><span className="ovad-sr">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((variant) => (
                <tr key={variant.id}>
                  <td>{variant.sku}</td>
                  <td>{variant.color_hex ? <span className="ovad-swatch" style={{ background: variant.color_hex }} aria-hidden="true" /> : null}{variant.color_name || '—'}</td>
                  <td>{variant.size_label || '—'}</td>
                  <td><Money value={variant.price_pkr} /></td>
                  <td>{variant.active ? <Badge tone="ok">active</Badge> : <Badge tone="muted">off</Badge>}</td>
                  <td><Button onClick={() => setEditing(variant.id)} aria-label={`Edit variant ${variant.sku}`}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {rows.filter((variant) => variant.id === editing).map((variant) => (
          <VariantForm key={variant.id} productId={product.id} variant={variant} onSaved={saved} onCancel={() => setEditing(null)} />
        ))}
      </LoadState>
    </Card>
  );
}
