/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useState } from 'react';
import { useAction, useAdmin, useLoad, useNotice } from '../hooks.js';
import { describeProblems } from '../errors.js';
import { CONTACT_KEYS, parseCount, parsePkr, parseProvinces, provincesToText, settingText, validateCode, validateContactValue } from '../helpers.js';
import { Badge, Button, Card, CheckInput, LoadState, Money, NoticeSlot, PageHeader, SelectInput, TableWrap, TextArea, TextInput, useConfirm } from '../ui.jsx';

/** A small form driven by a field list. validate(form) returns { ok, value } or { ok: false, errors }. */
function RecordForm({ fields, initial, validate, onSubmit, submitLabel, onCancel, label }) {
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const submit = async (event) => {
    event.preventDefault();
    const checked = validate(form);
    setErrors(checked.errors || {});
    if (!checked.ok) { notice.fail(new Error('Fix the highlighted fields.')); return; }
    const result = await run(() => onSubmit(checked.value), 'Saved.');
    if (result.ok && onCancel) onCancel();
  };
  return (
    <form className="ovad-form ovad-form-grid ovad-subform" onSubmit={submit} aria-label={label}>
      {fields.map((f) => {
        const set = (v) => setForm((s) => ({ ...s, [f.key]: v }));
        if (f.type === 'select') return <SelectInput key={f.key} label={f.label} hint={f.hint} error={errors[f.key]} value={form[f.key]} options={f.options} disabled={f.disabled} onChange={set} />;
        if (f.type === 'check') return <CheckInput key={f.key} label={f.label} hint={f.hint} checked={form[f.key]} onChange={set} />;
        return <TextInput key={f.key} label={f.label} hint={f.hint} error={errors[f.key]} value={form[f.key]} disabled={f.disabled} inputMode={f.numeric ? 'numeric' : undefined} maxLength={f.max} wide={f.wide} onChange={set} />;
      })}
      <div className="ovad-field-wide"><NoticeSlot notice={notice.notice} /></div>
      <div className="ovad-row ovad-field-wide">
        <Button type="submit" tone="primary" busy={busy}>{submitLabel}</Button>
        {onCancel ? <Button onClick={onCancel}>Close</Button> : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- ordering switch
function OrderingSection() {
  const { gateway, role } = useAdmin();
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const [dialog, ask] = useConfirm();
  const state = useLoad(async () => {
    const [setting, readiness] = await Promise.all([
      gateway.query((db) => db.from('store_settings').select('value').eq('key', 'ordering_enabled').maybeSingle()),
      gateway.rpc('admin_ordering_readiness'),
    ]);
    return { enabled: setting?.value === true, readiness };
  }, []);
  const d = state.data;
  const problems = describeProblems(d?.readiness?.problems);
  const owner = role === 'owner';

  const toggle = (enable) => ask({
    title: enable ? 'Open the store for orders?' : 'Close the store for orders?',
    body: enable
      ? <p>Customers will be able to place real orders. Only products marked ready to sell can be bought. Make sure prices, stock, shipping, payment methods and policies are correct.</p>
      : <p>Customers will no longer be able to place orders. Orders already placed are not affected.</p>,
    confirmLabel: enable ? 'Open for orders' : 'Close orders', danger: enable,
    action: async () => { const result = await run(() => gateway.rpc('admin_set_ordering_enabled', { p_enabled: enable }), enable ? 'Ordering is now ON.' : 'Ordering is now OFF.'); if (result.ok) state.reload(); },
  });

  return (
    <Card title="Ordering">
      <LoadState loading={state.loading} error={state.error} data={d} onRetry={state.reload}>
        {d ? (
          <>
            <p className="ovad-row"><Badge tone={d.enabled ? 'ok' : 'warn'}>{d.enabled ? 'Ordering is ON' : 'Ordering is OFF'}</Badge></p>
            {problems.length ? (
              <><p>Before ordering can be turned on:</p><ul className="ovad-problems">{problems.map((text) => <li key={text}>Fix: {text}.</li>)}</ul></>
            ) : <p><Badge tone="ok">Every readiness check passes</Badge></p>}
            <NoticeSlot notice={notice.notice} />
            <div className="ovad-row">
              {d.enabled
                ? <Button tone="danger" busy={busy} disabled={!owner} onClick={() => toggle(false)}>Turn ordering off</Button>
                : <Button tone="primary" busy={busy} disabled={!owner || problems.length > 0} onClick={() => toggle(true)}>Turn ordering on</Button>}
              {!owner ? <small>Only the store owner can change this.</small> : null}
            </div>
          </>
        ) : null}
      </LoadState>
      {dialog}
    </Card>
  );
}

// ---------------------------------------------------------------- payment methods
function PaymentSection() {
  const { gateway } = useAdmin();
  const [editing, setEditing] = useState(null);
  const list = useLoad(() => gateway.query((db) => db.from('payment_methods').select('code, label, description, kind, provider, enabled, sort_order').order('sort_order').order('code')), []);
  const saved = () => { setEditing(null); list.reload(); };
  const fields = [
    { key: 'label', label: 'Label shown to customers' }, { key: 'description', label: 'Description', wide: true, max: 300 },
    { key: 'sort_order', label: 'Display order', numeric: true }, { key: 'enabled', label: 'Enabled at checkout', type: 'check', hint: 'Only turn a method on once you can really accept it.' },
  ];
  const validate = (form) => {
    const errors = {};
    if (!form.label.trim() || form.label.length > 80) errors.label = 'Label: 1 to 80 characters.';
    if (form.description.length > 300) errors.description = '300 characters at most.';
    const order = parseCount(form.sort_order, { max: 100000 });
    if (!order.ok) errors.sort_order = order.reason;
    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { label: form.label.trim(), description: form.description.trim(), sort_order: order.value, enabled: form.enabled } };
  };
  return (
    <Card title="Payment methods">
      <p className="ovad-note">Cash on delivery stays off until you enable it. Online payment providers are not connected yet, so none can be enabled here.</p>
      <LoadState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} empty={list.data && list.data.length === 0} emptyText="No payment methods.">
        <TableWrap label="Payment methods">
          <table className="ovad-table">
            <thead><tr><th scope="col">Code</th><th scope="col">Label</th><th scope="col">Kind</th><th scope="col">State</th><th scope="col"><span className="ovad-sr">Actions</span></th></tr></thead>
            <tbody>
              {(list.data || []).map((m) => (
                <tr key={m.code}><td>{m.code}</td><td>{m.label}</td><td>{m.kind}</td><td>{m.enabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="muted">off</Badge>}</td>
                  <td><Button onClick={() => setEditing(m.code)} aria-label={`Edit payment method ${m.code}`}>Edit</Button></td></tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {(list.data || []).filter((m) => m.code === editing).map((m) => (
          <RecordForm key={m.code} label={`Edit ${m.code}`} fields={fields} validate={validate} submitLabel="Save payment method" onCancel={() => setEditing(null)}
            initial={{ label: m.label, description: m.description, sort_order: String(m.sort_order), enabled: m.enabled }}
            onSubmit={async (value) => { await gateway.query((db) => db.from('payment_methods').update(value).eq('code', m.code)); saved(); }} />
        ))}
      </LoadState>
    </Card>
  );
}

// ---------------------------------------------------------------- shipping
function ZonesSection({ zones, reload }) {
  const { gateway } = useAdmin();
  const [editing, setEditing] = useState(null);
  const fields = (isNew) => [
    { key: 'code', label: 'Code', disabled: !isNew, hint: 'Lower-case letters, digits, underscores. Fixed after creation.' },
    { key: 'name', label: 'Name' },
    { key: 'provinces', label: 'Provinces (comma separated)', wide: true, hint: 'Leave empty for every province.' },
  ];
  const validate = (isNew) => (form) => {
    const errors = {};
    if (isNew) { const code = validateCode(form.code); if (!code.ok) errors.code = code.reason; }
    if (!form.name.trim() || form.name.length > 80) errors.name = 'Name: 1 to 80 characters.';
    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { ...(isNew ? { code: form.code.trim() } : {}), name: form.name.trim(), provinces: parseProvinces(form.provinces) } };
  };
  const close = () => { setEditing(null); reload(); };
  const zone = zones.find((z) => z.code === editing);
  return (
    <>
      <div className="ovad-card-head"><h3>Zones</h3><Button onClick={() => setEditing('new')}>Add zone</Button></div>
      <TableWrap label="Shipping zones">
        <table className="ovad-table">
          <thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Provinces</th><th scope="col"><span className="ovad-sr">Actions</span></th></tr></thead>
          <tbody>{zones.map((z) => <tr key={z.code}><td>{z.code}</td><td>{z.name}</td><td>{z.provinces ? z.provinces.join(', ') : 'All provinces'}</td><td><Button onClick={() => setEditing(z.code)} aria-label={`Edit zone ${z.code}`}>Edit</Button></td></tr>)}</tbody>
        </table>
      </TableWrap>
      {editing === 'new' ? <RecordForm label="Add zone" fields={fields(true)} validate={validate(true)} submitLabel="Add zone" onCancel={() => setEditing(null)} initial={{ code: '', name: '', provinces: '' }}
        onSubmit={async (value) => { await gateway.query((db) => db.from('shipping_zones').insert(value)); close(); }} /> : null}
      {zone ? <RecordForm key={zone.code} label={`Edit zone ${zone.code}`} fields={fields(false)} validate={validate(false)} submitLabel="Save zone" onCancel={() => setEditing(null)} initial={{ code: zone.code, name: zone.name, provinces: provincesToText(zone.provinces) }}
        onSubmit={async (value) => { await gateway.query((db) => db.from('shipping_zones').update(value).eq('code', zone.code)); close(); }} /> : null}
    </>
  );
}

function MethodsSection({ methods, reload }) {
  const { gateway } = useAdmin();
  const [editing, setEditing] = useState(null);
  const fields = (isNew) => [
    { key: 'code', label: 'Code', disabled: !isNew }, { key: 'label', label: 'Label shown to customers' },
    { key: 'estimate_text', label: 'Delivery estimate text', wide: true, hint: 'Only write an estimate you can keep.', max: 120 },
    { key: 'description', label: 'Description', wide: true, max: 300 }, { key: 'sort_order', label: 'Display order', numeric: true },
    { key: 'enabled', label: 'Enabled at checkout', type: 'check' },
  ];
  const validate = (isNew) => (form) => {
    const errors = {};
    if (isNew) { const code = validateCode(form.code); if (!code.ok) errors.code = code.reason; }
    if (!form.label.trim() || form.label.length > 80) errors.label = 'Label: 1 to 80 characters.';
    if (form.estimate_text.length > 120) errors.estimate_text = '120 characters at most.';
    if (form.description.length > 300) errors.description = '300 characters at most.';
    const order = parseCount(form.sort_order, { max: 100000 });
    if (!order.ok) errors.sort_order = order.reason;
    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { ...(isNew ? { code: form.code.trim() } : {}), label: form.label.trim(), description: form.description.trim(), estimate_text: form.estimate_text.trim(), sort_order: order.value, enabled: form.enabled } };
  };
  const close = () => { setEditing(null); reload(); };
  const method = methods.find((m) => m.code === editing);
  const toForm = (m) => ({ code: m.code, label: m.label, estimate_text: m.estimate_text, description: m.description, sort_order: String(m.sort_order), enabled: m.enabled });
  return (
    <>
      <div className="ovad-card-head"><h3>Methods</h3><Button onClick={() => setEditing('new')}>Add method</Button></div>
      <TableWrap label="Shipping methods">
        <table className="ovad-table">
          <thead><tr><th scope="col">Code</th><th scope="col">Label</th><th scope="col">Estimate</th><th scope="col">State</th><th scope="col"><span className="ovad-sr">Actions</span></th></tr></thead>
          <tbody>{methods.map((m) => <tr key={m.code}><td>{m.code}</td><td>{m.label}</td><td>{m.estimate_text || '—'}</td><td>{m.enabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="muted">off</Badge>}</td><td><Button onClick={() => setEditing(m.code)} aria-label={`Edit method ${m.code}`}>Edit</Button></td></tr>)}</tbody>
        </table>
      </TableWrap>
      {editing === 'new' ? <RecordForm label="Add method" fields={fields(true)} validate={validate(true)} submitLabel="Add method" onCancel={() => setEditing(null)} initial={{ code: '', label: '', estimate_text: '', description: '', sort_order: '0', enabled: false }}
        onSubmit={async (value) => { await gateway.query((db) => db.from('shipping_methods').insert(value)); close(); }} /> : null}
      {method ? <RecordForm key={method.code} label={`Edit method ${method.code}`} fields={fields(false)} validate={validate(false)} submitLabel="Save method" onCancel={() => setEditing(null)} initial={toForm(method)}
        onSubmit={async (value) => { await gateway.query((db) => db.from('shipping_methods').update(value).eq('code', method.code)); close(); }} /> : null}
    </>
  );
}

function RatesSection({ rates, methods, zones, reload }) {
  const { gateway } = useAdmin();
  const [editing, setEditing] = useState(null);
  const fields = (isNew) => [
    { key: 'method_code', label: 'Method', type: 'select', disabled: !isNew, options: [{ value: '', label: 'Choose…' }, ...methods.map((m) => ({ value: m.code, label: m.label }))] },
    { key: 'zone_code', label: 'Zone', type: 'select', disabled: !isNew, options: [{ value: '', label: 'Choose…' }, ...zones.map((z) => ({ value: z.code, label: z.name }))] },
    { key: 'price_pkr', label: 'Price (PKR, whole rupees)', numeric: true }, { key: 'free_over_pkr', label: 'Free over (PKR, optional)', numeric: true, hint: 'Leave empty for no free-shipping threshold.' },
    { key: 'enabled', label: 'Enabled', type: 'check' },
  ];
  const validate = (isNew) => (form) => {
    const errors = {};
    if (isNew && !form.method_code) errors.method_code = 'Choose a method.';
    if (isNew && !form.zone_code) errors.zone_code = 'Choose a zone.';
    const price = parsePkr(form.price_pkr, { max: 10000000 });
    if (!price.ok) errors.price_pkr = price.reason;
    let free = null;
    if (form.free_over_pkr.trim() !== '') { const f = parsePkr(form.free_over_pkr, { min: 1, max: 100000000 }); if (!f.ok) errors.free_over_pkr = f.reason; else free = f.value; }
    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { ...(isNew ? { method_code: form.method_code, zone_code: form.zone_code } : {}), price_pkr: price.value, free_over_pkr: free, enabled: form.enabled } };
  };
  const close = () => { setEditing(null); reload(); };
  const rate = rates.find((r) => r.id === editing);
  const methodName = (code) => methods.find((m) => m.code === code)?.label || code;
  const zoneName = (code) => zones.find((z) => z.code === code)?.name || code;
  return (
    <>
      <div className="ovad-card-head"><h3>Rates</h3><Button onClick={() => setEditing('new')} disabled={!methods.length || !zones.length}>Add rate</Button></div>
      <p className="ovad-note">Rates and zones cannot be deleted; switch a rate off instead. A method needs an enabled rate before customers can choose it.</p>
      <TableWrap label="Shipping rates">
        <table className="ovad-table">
          <thead><tr><th scope="col">Method</th><th scope="col">Zone</th><th scope="col">Price</th><th scope="col">Free over</th><th scope="col">State</th><th scope="col"><span className="ovad-sr">Actions</span></th></tr></thead>
          <tbody>{rates.map((r) => <tr key={r.id}><td>{methodName(r.method_code)}</td><td>{zoneName(r.zone_code)}</td><td><Money value={r.price_pkr} /></td><td>{r.free_over_pkr ? <Money value={r.free_over_pkr} /> : '—'}</td><td>{r.enabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="muted">off</Badge>}</td><td><Button onClick={() => setEditing(r.id)} aria-label={`Edit rate ${methodName(r.method_code)} ${zoneName(r.zone_code)}`}>Edit</Button></td></tr>)}</tbody>
        </table>
      </TableWrap>
      {editing === 'new' ? <RecordForm label="Add rate" fields={fields(true)} validate={validate(true)} submitLabel="Add rate" onCancel={() => setEditing(null)} initial={{ method_code: '', zone_code: '', price_pkr: '', free_over_pkr: '', enabled: true }}
        onSubmit={async (value) => { await gateway.query((db) => db.from('shipping_rates').insert(value)); close(); }} /> : null}
      {rate ? <RecordForm key={rate.id} label="Edit rate" fields={fields(false)} validate={validate(false)} submitLabel="Save rate" onCancel={() => setEditing(null)}
        initial={{ method_code: rate.method_code, zone_code: rate.zone_code, price_pkr: String(rate.price_pkr), free_over_pkr: rate.free_over_pkr ? String(rate.free_over_pkr) : '', enabled: rate.enabled }}
        onSubmit={async (value) => { await gateway.query((db) => db.from('shipping_rates').update(value).eq('id', rate.id)); close(); }} /> : null}
    </>
  );
}

function ShippingSection() {
  const { gateway } = useAdmin();
  const state = useLoad(async () => {
    const [zones, methods, rates] = await Promise.all([
      gateway.query((db) => db.from('shipping_zones').select('code, name, provinces').order('code')),
      gateway.query((db) => db.from('shipping_methods').select('code, label, description, estimate_text, enabled, sort_order').order('sort_order').order('code')),
      gateway.query((db) => db.from('shipping_rates').select('id, method_code, zone_code, price_pkr, free_over_pkr, enabled').order('method_code').order('zone_code')),
    ]);
    return { zones, methods, rates };
  }, []);
  return (
    <Card title="Shipping">
      <LoadState loading={state.loading} error={state.error} data={state.data} onRetry={state.reload}>
        {state.data ? (
          <>
            <ZonesSection zones={state.data.zones} reload={state.reload} />
            <MethodsSection methods={state.data.methods} reload={state.reload} />
            <RatesSection rates={state.data.rates} methods={state.data.methods} zones={state.data.zones} reload={state.reload} />
          </>
        ) : null}
      </LoadState>
    </Card>
  );
}

// ---------------------------------------------------------------- public contact details and notice
const CONTACT_LABELS = {
  'contact.email': 'Public email', 'contact.phone': 'Public phone', 'contact.whatsapp': 'WhatsApp number',
  'contact.instagram': 'Instagram', 'contact.address': 'Address',
};

function PublicInfoSection() {
  const { gateway } = useAdmin();
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const state = useLoad(() => gateway.query((db) => db.from('store_settings').select('key, value').in('key', [...CONTACT_KEYS, 'notice.footer'])), []);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const current = state.data ? Object.fromEntries(state.data.map((row) => [row.key, settingText(row.value)])) : null;
  const values = form || current;

  const save = async (event) => {
    event.preventDefault();
    const next = {}; const out = {};
    for (const key of CONTACT_KEYS) {
      const checked = validateContactValue(key, values[key] ?? '');
      if (!checked.ok) next[key] = checked.reason; else out[key] = checked.value;
    }
    const noticeText = (values['notice.footer'] ?? '').trim();
    if (noticeText.length > 300) next['notice.footer'] = 'Keep it under 300 characters.';
    out['notice.footer'] = noticeText;
    setErrors(next);
    if (Object.keys(next).length) { notice.fail(new Error('Fix the highlighted fields.')); return; }
    const changed = Object.entries(out).filter(([key, value]) => value !== current[key]);
    if (!changed.length) { notice.ok('Nothing changed.'); return; }
    const result = await run(async () => {
      for (const [key, value] of changed) await gateway.query((db) => db.from('store_settings').update({ value }).eq('key', key));
    }, 'Saved. The storefront shows these values publicly.');
    if (result.ok) { setForm(null); state.reload(); }
  };
  const set = (key) => (value) => setForm((f) => ({ ...(f || current), [key]: value }));

  return (
    <Card title="Public contact details and notice">
      <p className="ovad-note">These appear on the storefront for everyone. Leave a field empty to show nothing. Do not enter details you do not want public.</p>
      <LoadState loading={state.loading} error={state.error} data={state.data} onRetry={state.reload}>
        {values ? (
          <form className="ovad-form ovad-form-grid" onSubmit={save}>
            {CONTACT_KEYS.map((key) => <TextInput key={key} label={CONTACT_LABELS[key]} value={values[key] ?? ''} onChange={set(key)} error={errors[key]} maxLength={300} wide={key === 'contact.address'} />)}
            <TextArea label="Store notice (footer)" value={values['notice.footer'] ?? ''} onChange={set('notice.footer')} error={errors['notice.footer']} rows={2} maxLength={300} hint="Shown in the site footer. Keep it true: say orders are not open while they are not." />
            <div className="ovad-field-wide"><NoticeSlot notice={notice.notice} /></div>
            <div className="ovad-row ovad-field-wide"><Button type="submit" tone="primary" busy={busy}>Save</Button></div>
          </form>
        ) : null}
      </LoadState>
    </Card>
  );
}

export default function Settings() {
  return (
    <>
      <PageHeader title="Settings" lead="Ordering, payment, shipping and the public details customers see." />
      <OrderingSection />
      <PaymentSection />
      <ShippingSection />
      <PublicInfoSection />
    </>
  );
}
