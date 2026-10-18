/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useState } from 'react';
import { useAction, useAdmin, useLoad, useNotice } from '../hooks.js';
import { Button, Card, DateText, LoadState, NoticeSlot, PageHeader, SelectInput, StatusBadge, TableWrap, TextArea } from '../ui.jsx';

const STATUSES = ['new', 'read', 'replied', 'spam', 'archived'];
const STATUS_OPTIONS = STATUSES.map((value) => ({ value, label: value }));

function MessagePanel({ message, onChanged, onClose }) {
  const { gateway } = useAdmin();
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const [status, setStatus] = useState(message.status);
  const [note, setNote] = useState(message.admin_note || '');
  const [error, setError] = useState('');

  const save = async (event) => {
    event.preventDefault();
    if (note.length > 1000) { setError('Note: 1000 characters at most.'); return; }
    setError('');
    const result = await run(() => gateway.query((db) => db.from('contact_messages').update({ status, admin_note: note }).eq('id', message.id)), 'Saved.');
    if (result.ok) onChanged();
  };

  return (
    <Card title={`${message.first_name} ${message.last_name}`.trim()} actions={<Button onClick={onClose}>Close</Button>}>
      <p className="ovad-row"><StatusBadge value={message.status} /> <small><DateText value={message.created_at} /></small> {message.kind === 'return_request' ? <span>Return request</span> : null}</p>
      <dl className="ovad-dl">
        <div><dt>Email</dt><dd>{message.email}</dd></div>
        {message.phone ? <div><dt>Phone</dt><dd>{message.phone}</dd></div> : null}
        {message.order_number ? <div><dt>Order number</dt><dd>{message.order_number}</dd></div> : null}
        {message.topics?.length ? <div><dt>Topics</dt><dd>{message.topics.join(', ')}</dd></div> : null}
      </dl>
      <p className="ovad-message-text">{message.message}</p>
      <form className="ovad-form" onSubmit={save}>
        <SelectInput label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <TextArea label="Private note" value={note} onChange={setNote} error={error} rows={3} maxLength={1000} hint="Only staff see this." />
        <NoticeSlot notice={notice.notice} />
        <div className="ovad-row"><Button type="submit" tone="primary" busy={busy}>Save</Button></div>
      </form>
    </Card>
  );
}

export default function Messages() {
  const { gateway } = useAdmin();
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const list = useLoad(() => gateway.query((db) => {
    let query = db.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(200);
    if (filter) query = query.eq('status', filter);
    return query;
  }), [filter]);
  const rows = list.data || [];
  const selected = rows.find((row) => row.id === selectedId);

  return (
    <>
      <PageHeader title="Messages" lead="Messages from the contact form. Replying happens in your own email; here you track the status." />
      {selected ? <MessagePanel key={`${selected.id}-${selected.updated_at}`} message={selected} onChanged={list.reload} onClose={() => setSelectedId(null)} /> : null}
      <Card>
        <div className="ovad-filters"><SelectInput label="Status" value={filter} onChange={setFilter} options={[{ value: '', label: 'All' }, ...STATUS_OPTIONS]} /></div>
        <LoadState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} empty={list.data && rows.length === 0} emptyText="No messages.">
          <TableWrap label="Messages">
            <table className="ovad-table">
              <thead><tr><th scope="col">Received</th><th scope="col">From</th><th scope="col">Message</th><th scope="col">Status</th><th scope="col"><span className="ovad-sr">Open</span></th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><DateText value={row.created_at} /></td>
                    <td>{row.first_name} {row.last_name}<br /><small>{row.email}</small></td>
                    <td className="ovad-clip">{row.message.slice(0, 120)}{row.message.length > 120 ? '…' : ''}</td>
                    <td><StatusBadge value={row.status} /></td>
                    <td><Button onClick={() => setSelectedId(row.id)} aria-label={`Open message from ${row.first_name}`}>Open</Button></td>
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
