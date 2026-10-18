/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Small shared building blocks for the admin pages: loading/error/empty states, labelled fields, a scrollable table
// region, a pager and a confirmation dialog (native <dialog>: focus is trapped, Escape closes, focus returns).
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { formatPrice } from '../lib/money.js';

export const Money = ({ value }) => (Number.isInteger(value) ? formatPrice(value) : '—');

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
export const DateText = ({ value }) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? <time dateTime={date.toISOString()}>{dateFormat.format(date)}</time> : '—';
};

export function PageHeader({ title, children, lead }) {
  return (
    <header className="ovad-page-head">
      <div>
        <h1>{title}</h1>
        {lead ? <p className="ovad-lead">{lead}</p> : null}
      </div>
      {children ? <div className="ovad-page-actions">{children}</div> : null}
    </header>
  );
}

export function Card({ title, children, actions, id, tone }) {
  const headingId = useId();
  return (
    <section className={`ovad-card${tone ? ` ovad-card-${tone}` : ''}`} aria-labelledby={title ? headingId : undefined} id={id}>
      {title || actions ? (
        <div className="ovad-card-head">
          {title ? <h2 id={headingId}>{title}</h2> : <span />}
          {actions ? <div className="ovad-card-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`ovad-badge ovad-badge-${tone}`}>{children}</span>;
}

const STATUS_TONE = {
  published: 'ok', approved: 'ok', paid: 'ok', delivered: 'ok', confirmed: 'ok', sent: 'ok', replied: 'ok', processed: 'ok',
  draft: 'neutral', unfulfilled: 'neutral', unpaid: 'warn', pending: 'warn', processing: 'warn', shipped: 'info', requested: 'warn', unverified: 'warn',
  new: 'warn', read: 'neutral', skipped: 'neutral', closed: 'neutral', received: 'info',
  archived: 'muted', cancelled: 'bad', failed: 'bad', rejected: 'bad', spam: 'bad', refunded: 'info', partially_refunded: 'info',
};
export const StatusBadge = ({ value }) => <Badge tone={STATUS_TONE[value] || 'neutral'}>{String(value ?? '—').replace(/_/g, ' ')}</Badge>;

export function Spinner({ label = 'Loading' }) {
  return <p className="ovad-loading" role="status"><span className="ovad-spinner" aria-hidden="true" />{label}…</p>;
}

/** Shows the right state for a list or record: loading, a real error with retry, empty, or the content. */
export function LoadState({ loading, error, onRetry, empty, emptyText = 'Nothing here yet.', data, children }) {
  if (error && !data) {
    return (
      <div className="ovad-error" role="alert">
        <p>{error.message || 'Could not load this.'}</p>
        {onRetry ? <button type="button" className="ovad-btn" onClick={onRetry}>Try again</button> : null}
      </div>
    );
  }
  if (loading && !data) return <Spinner />;
  if (empty) return <p className="ovad-empty">{emptyText}</p>;
  return children;
}

/** Result message slot. The live region is always present so screen readers announce changes. */
export function NoticeSlot({ notice }) {
  return (
    <div className="ovad-notice-slot" aria-live="polite">
      {notice ? (
        <p className={`ovad-notice ovad-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
      ) : null}
    </div>
  );
}

export function Button({ busy = false, tone = 'secondary', type = 'button', disabled, children, ...rest }) {
  return (
    <button type={type} className={`ovad-btn ovad-btn-${tone}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {children}
    </button>
  );
}

/** Label + control + hint/error wired together. children(props) must spread props onto the control. */
export function Field({ label, hint, error, children, wide = false }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`ovad-field${wide ? ' ovad-field-wide' : ''}${error ? ' ovad-field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint ? <small id={`${id}-hint`}>{hint}</small> : null}
      {error ? <small id={`${id}-error`} className="ovad-field-error">{error}</small> : null}
    </div>
  );
}

export function TextInput({ label, value, onChange, hint, error, wide, type = 'text', ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} wide={wide}>
      {(aria) => <input {...aria} type={type} value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...rest} />}
    </Field>
  );
}

export function TextArea({ label, value, onChange, hint, error, rows = 4, wide = true, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} wide={wide}>
      {(aria) => <textarea {...aria} rows={rows} value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...rest} />}
    </Field>
  );
}

export function SelectInput({ label, value, onChange, options, hint, error, wide, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} wide={wide}>
      {(aria) => (
        <select {...aria} value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...rest}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </Field>
  );
}

export function CheckInput({ label, checked, onChange, hint, ...rest }) {
  const id = useId();
  return (
    <div className="ovad-check">
      <input id={id} type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} {...rest} />
      <label htmlFor={id}>{label}</label>
      {hint ? <small id={`${id}-hint`}>{hint}</small> : null}
    </div>
  );
}

/** Tables scroll inside this region, never the page. It is focusable so the keyboard can scroll it. */
export function TableWrap({ label, children }) {
  return <div className="ovad-table-wrap" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export function Pager({ offset, limit, total, onChange, busy }) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav className="ovad-pager" aria-label="Pages">
      <span>{total === 0 ? 'No results' : `${from}–${to} of ${total}`}</span>
      <Button disabled={busy || offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
      <Button disabled={busy || offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</Button>
    </nav>
  );
}

export function Definition({ items }) {
  return (
    <dl className="ovad-dl">
      {items.filter(Boolean).map(([term, value]) => (
        <div key={term}><dt>{term}</dt><dd>{value ?? '—'}</dd></div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- confirmation dialog
/**
 * Native <dialog> opened with showModal(): the rest of the page is inert, Tab stays inside, Escape cancels,
 * and focus returns to the element that opened it. An optional text input can be required (a reason).
 */
export function ConfirmDialog({ request, busy, onConfirm, onCancel }) {
  const ref = useRef(null);
  const openerRef = useRef(null);
  const [value, setValue] = useState('');
  const open = Boolean(request);
  const titleId = useId();
  const inputId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    if (open && !dialog.open) {
      openerRef.current = document.activeElement;
      setValue('');
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    }
    return undefined;
  }, [open]);

  const input = request?.input;
  const trimmed = value.trim();
  const inputOk = !input || !input.required || trimmed.length >= (input.min ?? 1);
  return (
    <dialog
      ref={ref}
      className="ovad-dialog"
      aria-labelledby={titleId}
      data-lenis-prevent
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
    >
      {request ? (
        <form method="dialog" onSubmit={(event) => { event.preventDefault(); if (inputOk && !busy) onConfirm(trimmed); }}>
          <h2 id={titleId}>{request.title}</h2>
          <div className="ovad-dialog-body">{request.body}</div>
          {input ? (
            <div className="ovad-field ovad-field-wide">
              <label htmlFor={inputId}>{input.label}</label>
              <textarea id={inputId} rows={3} value={value} maxLength={input.max ?? 300} onChange={(event) => setValue(event.target.value)} aria-required={input.required || undefined} />
              {input.hint ? <small>{input.hint}</small> : null}
            </div>
          ) : null}
          <div className="ovad-dialog-actions">
            <Button onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button type="submit" tone={request.danger ? 'danger' : 'primary'} busy={busy} disabled={!inputOk}>{request.confirmLabel || 'Confirm'}</Button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}

/**
 * const [dialog, ask] = useConfirm();   ask({ title, body, confirmLabel, danger, input, action(value) })
 * `action` runs when the person confirms; the dialog closes when it settles.
 */
export function useConfirm() {
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const ask = useCallback((next) => setRequest(next), []);
  const cancel = useCallback(() => setRequest(null), []);
  const confirm = useCallback(async (value) => {
    if (!request) return;
    setBusy(true);
    try { await request.action(value); } finally { setBusy(false); setRequest(null); }
  }, [request]);
  const dialog = <ConfirmDialog request={request} busy={busy} onConfirm={confirm} onCancel={cancel} />;
  return [dialog, ask];
}
