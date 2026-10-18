/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useState } from 'react';
import { useAdmin, useLoad } from '../hooks.js';
import { Badge, Card, DateText, LoadState, PageHeader, SelectInput, TableWrap } from '../ui.jsx';

export default function Newsletter() {
  const { gateway } = useAdmin();
  const [filter, setFilter] = useState('');
  const list = useLoad(() => gateway.query((db) => db.from('newsletter_subscriptions')
    .select('id, email, consent_text, consent_at, source, unsubscribed_at, created_at').order('created_at', { ascending: false }).limit(1000)), []);
  const all = list.data || [];
  const rows = all.filter((row) => (filter === 'active' ? !row.unsubscribed_at : filter === 'unsubscribed' ? Boolean(row.unsubscribed_at) : true));
  const active = all.filter((row) => !row.unsubscribed_at).length;

  return (
    <>
      <PageHeader title="Newsletter" lead="Read-only. Each row keeps the consent wording the person saw and when they agreed. Unsubscribed addresses must not be emailed.">
        {list.data ? <Badge tone="ok">{active} subscribed</Badge> : null}
      </PageHeader>
      <Card>
        <div className="ovad-filters"><SelectInput label="Show" value={filter} onChange={setFilter} options={[{ value: '', label: 'Everyone' }, { value: 'active', label: 'Subscribed' }, { value: 'unsubscribed', label: 'Unsubscribed' }]} /></div>
        <LoadState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} empty={list.data && rows.length === 0} emptyText="No subscriptions.">
          <TableWrap label="Newsletter subscriptions">
            <table className="ovad-table">
              <thead><tr><th scope="col">Email</th><th scope="col">Consent given</th><th scope="col">Consent wording</th><th scope="col">Source</th><th scope="col">State</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.email}</td>
                    <td><DateText value={row.consent_at} /></td>
                    <td className="ovad-clip">{row.consent_text}</td>
                    <td>{row.source}</td>
                    <td>{row.unsubscribed_at ? <Badge tone="muted">unsubscribed <DateText value={row.unsubscribed_at} /></Badge> : <Badge tone="ok">subscribed</Badge>}</td>
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
