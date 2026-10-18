/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAction, useAdmin, useLoad, useNotice } from '../hooks.js';
import { describeProblems } from '../errors.js';
import { parseCount, slugify, validateSlug } from '../helpers.js';
import { Badge, Button, Card, DateText, LoadState, NoticeSlot, PageHeader, SelectInput, StatusBadge, TableWrap, TextArea, TextInput, useConfirm } from '../ui.jsx';
import ProductVariants from './ProductVariants.jsx';
import ProductImages from './ProductImages.jsx';

const KIND_OPTIONS = [{ value: 'watch', label: 'Watch' }, { value: 'clothing', label: 'Clothing' }];
const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, { value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'archived', label: 'Archived' }];

export function ProductsList() {
  const { gateway } = useAdmin();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const list = useLoad(() => gateway.query((db) => db.from('products')
    .select('id, slug, name, status, ready_to_sell, kind, sort_order, updated_at, category:categories(name), variants:product_variants(count)')
    .order('sort_order').order('name').limit(500)), []);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (list.data || []).filter((row) => (!status || row.status === status)
      && (!needle || row.name.toLowerCase().includes(needle) || row.slug.includes(needle)));
  }, [list.data, status, search]);

  return (
    <>
      <PageHeader title="Products" lead="Draft products are never shown on the storefront. Publishing and “ready to sell” are separate steps.">
        <Link className="ovad-btn ovad-btn-primary" to="/admin/products/new">New product</Link>
      </PageHeader>
      <Card>
        <div className="ovad-filters">
          <TextInput label="Search name or slug" value={search} onChange={setSearch} type="search" />
          <SelectInput label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        </div>
        <LoadState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} empty={list.data && rows.length === 0} emptyText={list.data && list.data.length ? 'No product matches this filter.' : 'No products yet. Create the first one.'}>
          <TableWrap label="Products">
            <table className="ovad-table">
              <thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Ready to sell</th><th scope="col">Variants</th><th scope="col">Updated</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><Link to={`/admin/products/${row.id}`}>{row.name}</Link><br /><small>{row.slug}</small></td>
                    <td>{row.kind}</td>
                    <td>{row.category?.name || '—'}</td>
                    <td><StatusBadge value={row.status} /></td>
                    <td>{row.ready_to_sell ? <Badge tone="ok">yes</Badge> : <Badge tone="muted">no</Badge>}</td>
                    <td>{row.variants?.[0]?.count ?? 0}</td>
                    <td><DateText value={row.updated_at} /></td>
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

const emptyForm = { name: '', slug: '', kind: 'clothing', category_id: '', brand_id: '', style: '', group_key: '', description: '', sort_order: '0' };
const fromProduct = (p) => ({
  name: p.name, slug: p.slug, kind: p.kind, category_id: p.category_id, brand_id: p.brand_id || '', style: p.style || '',
  group_key: p.group_key || '', description: p.description || '', sort_order: String(p.sort_order ?? 0),
});

function validateDetails(form, isNew) {
  const errors = {};
  const name = form.name.trim();
  if (!name || name.length > 160) errors.name = 'Name: 1 to 160 characters.';
  if (isNew) { const slug = validateSlug(form.slug); if (!slug.ok) errors.slug = slug.reason; }
  if (!form.category_id) errors.category_id = 'Choose a category.';
  if (form.style.trim().length > 60) errors.style = 'Style: 60 characters at most.';
  if (form.group_key.trim() && !validateSlug(form.group_key).ok) errors.group_key = 'Group key: lower-case words joined by dashes.';
  if (form.description.length > 4000) errors.description = 'Description: 4000 characters at most.';
  const order = parseCount(form.sort_order, { max: 100000 });
  if (!order.ok) errors.sort_order = order.reason;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name, kind: form.kind, category_id: form.category_id, brand_id: form.brand_id || null, style: form.style.trim() || null,
      group_key: form.group_key.trim() || null, description: form.description, sort_order: order.value,
      ...(isNew ? { slug: form.slug.trim() } : {}),
    },
  };
}

function Details({ product, categories, brands, isNew, onSaved }) {
  const { gateway } = useAdmin();
  const navigate = useNavigate();
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const [form, setForm] = useState(product ? fromProduct(product) : emptyForm);
  const [errors, setErrors] = useState({});
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (event) => {
    event.preventDefault();
    const checked = validateDetails(form, isNew);
    setErrors(checked.errors || {});
    if (!checked.ok) { notice.fail(new Error('Fix the highlighted fields.')); return; }
    if (isNew) {
      const result = await run(() => gateway.query((db) => db.from('products').insert(checked.value).select('id').single()), 'Draft created.');
      if (result.ok) navigate(`/admin/products/${result.result.id}`, { replace: true });
    } else {
      const result = await run(() => gateway.query((db) => db.from('products').update(checked.value).eq('id', product.id)), 'Details saved.');
      if (result.ok) onSaved();
    }
  };

  return (
    <Card title="Details">
      <form className="ovad-form ovad-form-grid" onSubmit={save}>
        <TextInput label="Name" value={form.name} onChange={(value) => { set('name')(value); if (isNew && (!form.slug || form.slug === slugify(form.name))) set('slug')(slugify(value)); }} error={errors.name} required maxLength={160} />
        <TextInput label="Slug (web address)" value={form.slug} onChange={set('slug')} error={errors.slug} disabled={!isNew} hint={isNew ? 'Lower-case words joined by dashes. It cannot be changed later because image file names use it.' : 'Fixed after creation.'} />
        <SelectInput label="Kind" value={form.kind} onChange={set('kind')} options={KIND_OPTIONS} />
        <SelectInput label="Category" value={form.category_id} onChange={set('category_id')} error={errors.category_id} options={[{ value: '', label: 'Choose…' }, ...categories.map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (off)` }))]} />
        <SelectInput label="Brand" value={form.brand_id} onChange={set('brand_id')} options={[{ value: '', label: 'No brand' }, ...brands.map((b) => ({ value: b.id, label: b.active ? b.name : `${b.name} (off)` }))]} />
        <TextInput label="Style" value={form.style} onChange={set('style')} error={errors.style} maxLength={60} />
        <TextInput label="Group key" value={form.group_key} onChange={set('group_key')} error={errors.group_key} hint="Products that are colour siblings of each other share a group key." />
        <TextInput label="Display order" value={form.sort_order} onChange={set('sort_order')} error={errors.sort_order} inputMode="numeric" />
        <TextArea label="Description" value={form.description} onChange={set('description')} error={errors.description} rows={6} maxLength={4000} hint="Plain text. Do not state facts you have not checked." />
        <div className="ovad-field-wide"><NoticeSlot notice={notice.notice} /></div>
        <div className="ovad-row ovad-field-wide">
          <Button type="submit" tone="primary" busy={busy}>{isNew ? 'Create draft' : 'Save details'}</Button>
          {isNew ? <Link className="ovad-link" to="/admin/products">Cancel</Link> : null}
        </div>
      </form>
    </Card>
  );
}

function StatusPanel({ product, rev, onChanged }) {
  const { gateway } = useAdmin();
  const navigate = useNavigate();
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const [dialog, ask] = useConfirm();
  const readiness = useLoad(() => gateway.rpc('product_readiness', { p_product_id: product.id }), [product.id, rev, product.status]);
  const problems = Array.isArray(readiness.data) ? readiness.data : null;

  const setStatus = (values, message) => run(async () => { await gateway.query((db) => db.from('products').update(values).eq('id', product.id)); onChanged(); }, message);

  const archive = () => ask({
    title: `Archive “${product.name}”?`,
    body: <p>It disappears from the storefront and cannot be bought. Existing orders keep their own copy of the details. You can restore it to draft later.</p>,
    confirmLabel: 'Archive', danger: true,
    action: () => setStatus({ status: 'archived', ready_to_sell: false }, 'Product archived.'),
  });
  const remove = () => ask({
    title: `Delete draft “${product.name}”?`,
    body: <p>This permanently deletes the draft, its variants and its image records. It cannot be undone. Products that appear on orders cannot be deleted.</p>,
    confirmLabel: 'Delete draft', danger: true,
    action: async () => { const result = await run(() => gateway.rpc('admin_delete_draft_product', { p_product_id: product.id }), 'Draft deleted.'); if (result.ok) navigate('/admin/products', { replace: true }); },
  });

  return (
    <Card title="Status and readiness">
      <p className="ovad-row">
        <StatusBadge value={product.status} />
        {product.ready_to_sell ? <Badge tone="ok">ready to sell</Badge> : <Badge tone="muted">not ready to sell</Badge>}
        {product.published_at ? <small>Published <DateText value={product.published_at} /></small> : null}
      </p>
      <p className="ovad-note">
        Published products can be browsed. Only products marked <strong>ready to sell</strong> can be bought, and only once ordering is switched on.
        A product is ready when it has an active variant with a price, counted stock, and an approved cover image.
      </p>
      <h3>Checks for “ready to sell”</h3>
      <LoadState loading={readiness.loading} error={readiness.error} data={problems} onRetry={readiness.reload}>
        {problems && problems.length === 0 ? <p><Badge tone="ok">All checks pass</Badge></p> : null}
        {problems && problems.length ? <ul className="ovad-problems">{describeProblems(problems).map((text) => <li key={text}>Missing: {text}.</li>)}</ul> : null}
      </LoadState>
      <NoticeSlot notice={notice.notice} />
      <div className="ovad-row">
        {product.status === 'draft' ? <Button tone="primary" busy={busy} onClick={() => setStatus({ status: 'published' }, 'Published. It is visible on the storefront but not for sale until marked ready.')}>Publish</Button> : null}
        {product.status === 'published' ? <Button busy={busy} onClick={() => setStatus({ status: 'draft', ready_to_sell: false }, 'Moved back to draft.')}>Unpublish (back to draft)</Button> : null}
        {product.status === 'published' && !product.ready_to_sell ? (
          <Button tone="primary" busy={busy} disabled={!problems || problems.length > 0} onClick={() => setStatus({ ready_to_sell: true }, 'Marked ready to sell.')}>Mark ready to sell</Button>
        ) : null}
        {product.ready_to_sell ? <Button busy={busy} onClick={() => setStatus({ ready_to_sell: false }, 'No longer ready to sell.')}>Remove “ready to sell”</Button> : null}
        {product.status === 'archived' ? <Button busy={busy} onClick={() => setStatus({ status: 'draft' }, 'Restored to draft.')}>Restore to draft</Button> : null}
        {product.status !== 'archived' ? <Button tone="danger" busy={busy} onClick={archive}>Archive</Button> : null}
        {product.status === 'draft' ? <Button tone="danger" busy={busy} onClick={remove}>Delete draft</Button> : null}
      </div>
      {dialog}
    </Card>
  );
}

export function ProductEditor() {
  const { id } = useParams();
  const { gateway } = useAdmin();
  const isNew = id === 'new';
  const [rev, setRev] = useState(0);
  const bump = () => setRev((value) => value + 1);

  const lookups = useLoad(async () => {
    const [categories, brands] = await Promise.all([
      gateway.query((db) => db.from('categories').select('id, name, slug, active').order('sort_order').order('name')),
      gateway.query((db) => db.from('brands').select('id, name, slug, active').order('name')),
    ]);
    return { categories, brands };
  }, []);
  const product = useLoad(async () => (isNew ? null : gateway.query((db) => db.from('products').select('*').eq('id', id).maybeSingle())), [id]);

  const missing = !isNew && !product.loading && !product.error && product.data === null;
  return (
    <>
      <PageHeader title={isNew ? 'New product' : (product.data?.name || 'Product')}>
        <Link className="ovad-link" to="/admin/products">All products</Link>
      </PageHeader>
      <LoadState loading={lookups.loading || (!isNew && product.loading)} error={lookups.error || product.error} data={lookups.data && (isNew || product.data)} onRetry={() => { lookups.reload(); product.reload(); }} empty={missing} emptyText="That product does not exist.">
        {lookups.data && (isNew || product.data) ? (
          <>
            <Details key={product.data?.id || 'new'} product={product.data} categories={lookups.data.categories} brands={lookups.data.brands} isNew={isNew} onSaved={() => product.reload()} />
            {!isNew ? (
              <>
                <StatusPanel product={product.data} rev={rev} onChanged={() => { product.reload(); bump(); }} />
                <ProductVariants product={product.data} onChanged={bump} />
                <ProductImages product={product.data} onChanged={bump} />
              </>
            ) : <p className="ovad-note">After you create the draft you can add variants, prices and photos.</p>}
          </>
        ) : null}
      </LoadState>
    </>
  );
}
