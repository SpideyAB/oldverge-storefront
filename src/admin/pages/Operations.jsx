/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useState } from 'react';
import { useAction, useAdmin, useLoad, useNotice } from '../hooks.js';
import { shortId } from '../helpers.js';
import { Button, Card, DateText, LoadState, NoticeSlot, PageHeader, SelectInput, StatusBadge, TableWrap } from '../ui.jsx';

const AUDIT_PAGE = 50;

function Tools({ onDone }) {
  const { gateway } = useAdmin();
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const maintenance = async () => {
    const result = await run(() => gateway.rpc('admin_run_maintenance'), (data) => `Maintenance finished. Expired unpaid orders released: ${data?.expired_orders ?? 0}. Old rate-limit rows removed: ${data?.rate_limit_rows_pruned ?? 0}.`);
    if (result.ok) onDone();
  };
  const outbox = async () => {
    const result = await run(() => gateway.fn('process-outbox', {}), (data) => (data?.provider === 'not_configured'
      ? 'No email provider is configured, so nothing was sent. Queued notifications are untouched.'
      : `Processed the queue: ${data?.sent ?? 0} sent, ${data?.failed ?? 0} failed.`));
    if (result.ok) onDone();
  };
  return (
    <Card title="Tools">
      <p className="ovad-note">Maintenance releases stock held by expired unpaid online orders and clears old counters. Processing sends queued customer emails when an email provider has been set up.</p>
      <div className="ovad-row">
        <Button busy={busy} onClick={maintenance}>Run maintenance</Button>
        <Button busy={busy} onClick={outbox}>Process notifications</Button>
      </div>
      <NoticeSlot notice={notice.notice} />
    </Card>
  );
}

function Outbox({ reloadKey }) {
  const { gateway } = useAdmin();
  const [status, setStatus] = useState('');
  const list = useLoad(() => gateway.query((db) => {
    let query = db.from('notification_outbox').select('id, kind, status, attempts, next_attempt_at, last_error, created_at, sent_at').order('created_at', { ascending: false }).limit(100);
    if (status) query = query.eq('status', status);
    return query;
  }), [status, reloadKey]);
  const rows = list.data || [];
  return (
    <Card title="Notification queue">
      <div className="ovad-filters"><SelectInput label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, ...['pending', 'sent', 'failed', 'skipped'].map((v) => ({ value: v, label: v }))]} /></div>
      <LoadState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} empty={list.data && rows.length === 0} emptyText="The queue is empty.">
        <TableWrap label="Notification queue">
          <table className="ovad-table">
            <thead><tr><th scope="col">Created</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">Next try</th><th scope="col">Last error</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}><td><DateText value={row.created_at} /></td><td>{row.kind}</td><td><StatusBadge value={row.status} /></td><td>{row.attempts}</td>
                  <td>{row.status === 'sent' ? <DateText value={row.sent_at} /> : <DateText value={row.next_attempt_at} />}</td><td className="ovad-clip">{row.last_error || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </LoadState>
    </Card>
  );
}

function AuditLog() {
  const { gateway } = useAdmin();
  const [entity, setEntity] = useState('');
  const [limit, setLimit] = useState(AUDIT_PAGE);
  const list = useLoad(() => gateway.query((db) => {
    let query = db.from('admin_audit_log').select('id, actor_id, action, entity, entity_id, after_data, created_at').order('created_at', { ascending: false }).limit(limit);
    if (entity.trim()) query = query.ilike('entity', `%${entity.trim().replace(/[%_\\]/g, '')}%`);
    return query;
  }), [entity, limit]);
  const rows = list.data || [];
  return (
    <Card title="Admin activity log">
      <p className="ovad-note">Every admin change is recorded here and cannot be edited or deleted.</p>
      <form className="ovad-filters" onSubmit={(event) => event.preventDefault()}>
        <label className="ovad-field"><span className="ovad-label-text">Filter by table</span>
          <input type="search" value={entity} onChange={(event) => { setEntity(event.target.value); setLimit(AUDIT_PAGE); }} placeholder="for example orders" /></label>
      </form>
      <LoadState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} empty={list.data && rows.length === 0} emptyText="No activity recorded.">
        <TableWrap label="Admin activity log">
          <table className="ovad-table">
            <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">Details</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><DateText value={row.created_at} /></td><td>{row.actor_id ? shortId(row.actor_id) : 'system'}</td><td>{row.action}</td>
                  <td>{row.entity}{row.entity_id ? <><br /><small>{String(row.entity_id).slice(0, 36)}</small></> : null}</td>
                  <td>{row.after_data ? <details><summary>Show</summary><pre className="ovad-pre">{JSON.stringify(row.after_data, null, 2)}</pre></details> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {rows.length >= limit ? <div className="ovad-row"><Button busy={list.loading} onClick={() => setLimit((value) => value + AUDIT_PAGE)}>Show more</Button></div> : null}
      </LoadState>
    </Card>
  );
}

export default function Operations() {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <>
      <PageHeader title="Operations" lead="Background jobs, queued emails and the record of admin changes." />
      <Tools onDone={() => setReloadKey((value) => value + 1)} />
      <Outbox reloadKey={reloadKey} />
      <AuditLog />
    </>
  );
}
