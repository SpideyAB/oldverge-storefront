/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useMemo, useState } from 'react';
import { useAction, useAdmin, useLoad, useNotice } from '../hooks.js';
import { normalizeSections, paragraphsToText, sectionsToStored, validateSections } from '../helpers.js';
import { Badge, Button, Card, DateText, LoadState, NoticeSlot, PageHeader, TableWrap, TextArea, TextInput, useConfirm } from '../ui.jsx';

const toEditable = (sections) => normalizeSections(sections).map((s) => ({ heading: s.heading, text: paragraphsToText(s.body) }));

function PolicyPreview({ sections }) {
  return (
    <div className="ovad-preview" aria-label="Preview">
      {sections.map((section, index) => (
        <section key={index}>
          <h4>{section.heading}</h4>
          {section.body.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
        </section>
      ))}
    </div>
  );
}

function PolicyEditor({ page, draft, onChanged, onClose }) {
  const { gateway, role } = useAdmin();
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const [dialog, ask] = useConfirm();
  const savedEditable = useMemo(() => toEditable(draft?.sections), [draft]);
  const [sections, setSections] = useState(savedEditable);
  const [preview, setPreview] = useState(false);
  const dirty = JSON.stringify(sections) !== JSON.stringify(savedEditable);
  const owner = role === 'owner';
  const stored = sectionsToStored(sections);
  const publishedJson = JSON.stringify(normalizeSections(page.published_sections));
  const unpublished = JSON.stringify(stored) !== publishedJson;

  const change = (index, key) => (value) => setSections((list) => list.map((s, i) => (i === index ? { ...s, [key]: value } : s)));
  const move = (index, by) => setSections((list) => {
    const target = index + by;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const save = async () => {
    const checked = stored.length ? validateSections(stored) : { ok: true };
    if (!checked.ok) { notice.fail(new Error(checked.reason)); return; }
    const result = await run(() => gateway.query((db) => db.from('policy_drafts').update({ sections: stored }).eq('slug', page.slug)), 'Draft saved. It is not public until you publish it.');
    if (result.ok) onChanged();
  };
  const publish = () => {
    const checked = validateSections(stored);
    if (!checked.ok) { notice.fail(new Error(checked.reason)); return; }
    ask({
      title: `Publish “${page.title}”?`,
      body: <p>The saved draft becomes the public policy page (version {page.version + 1}). Make sure it states your real terms; the site must not promise anything you will not honour.</p>,
      confirmLabel: 'Publish', danger: true,
      action: async () => { const result = await run(() => gateway.rpc('admin_publish_policy', { p_slug: page.slug }), (data) => `Published as version ${data?.version ?? ''}.`); if (result.ok) onChanged(); },
    });
  };

  return (
    <Card title={`Edit: ${page.title}`} actions={<Button onClick={onClose}>Close</Button>}>
      <p className="ovad-row">
        {page.published_at ? <Badge tone="ok">version {page.version} published</Badge> : <Badge tone="warn">never published</Badge>}
        {page.published_at ? <small><DateText value={page.published_at} /></small> : null}
        {unpublished && !dirty ? <Badge tone="warn">draft differs from published</Badge> : null}
        {dirty ? <Badge tone="bad">unsaved changes</Badge> : null}
      </p>
      {sections.length === 0 ? <p className="ovad-empty">The draft is empty. Add the first section.</p> : null}
      {sections.map((section, index) => (
        <fieldset key={index} className="ovad-section-edit">
          <legend>Section {index + 1}</legend>
          <TextInput label="Heading" value={section.heading} onChange={change(index, 'heading')} maxLength={160} wide />
          <TextArea label="Text" value={section.text} onChange={change(index, 'text')} rows={6} hint="Separate paragraphs with a blank line." />
          <div className="ovad-row">
            <Button onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move section ${index + 1} up`}>Move up</Button>
            <Button onClick={() => move(index, 1)} disabled={index === sections.length - 1} aria-label={`Move section ${index + 1} down`}>Move down</Button>
            <Button tone="danger" onClick={() => setSections((list) => list.filter((_, i) => i !== index))} aria-label={`Remove section ${index + 1}`}>Remove</Button>
          </div>
        </fieldset>
      ))}
      <div className="ovad-row">
        <Button onClick={() => setSections((list) => [...list, { heading: '', text: '' }])}>Add section</Button>
        <Button onClick={() => setPreview((value) => !value)} aria-pressed={preview}>{preview ? 'Hide preview' : 'Preview'}</Button>
      </div>
      {preview ? (stored.length ? <PolicyPreview sections={stored} /> : <p className="ovad-empty">Nothing to preview yet.</p>) : null}
      <NoticeSlot notice={notice.notice} />
      <div className="ovad-row">
        <Button tone="primary" busy={busy} disabled={!dirty} onClick={save}>Save draft</Button>
        <Button tone="danger" busy={busy} disabled={!owner || dirty || stored.length === 0} onClick={publish}>Publish draft</Button>
        {!owner ? <small>Only the store owner can publish.</small> : dirty ? <small>Save the draft before publishing.</small> : null}
      </div>
      {dialog}
    </Card>
  );
}

export default function Policies() {
  const { gateway } = useAdmin();
  const [slug, setSlug] = useState(null);
  const state = useLoad(async () => {
    const [pages, drafts] = await Promise.all([
      gateway.query((db) => db.from('policy_pages').select('slug, title, version, published_at, published_sections, updated_at').order('title')),
      gateway.query((db) => db.from('policy_drafts').select('slug, sections, updated_at')),
    ]);
    return { pages, drafts };
  }, []);
  const page = state.data?.pages.find((p) => p.slug === slug);
  const draft = state.data?.drafts.find((d) => d.slug === slug);

  return (
    <>
      <PageHeader title="Policies" lead="Shipping, returns, privacy and terms. Edits are drafts until the owner publishes them." />
      {page ? <PolicyEditor key={`${page.slug}-${page.version}-${draft?.updated_at}`} page={page} draft={draft} onChanged={state.reload} onClose={() => setSlug(null)} /> : null}
      <Card>
        <LoadState loading={state.loading} error={state.error} data={state.data} onRetry={state.reload} empty={state.data && state.data.pages.length === 0} emptyText="No policy pages exist.">
          <TableWrap label="Policies">
            <table className="ovad-table">
              <thead><tr><th scope="col">Policy</th><th scope="col">Published</th><th scope="col">Version</th><th scope="col"><span className="ovad-sr">Actions</span></th></tr></thead>
              <tbody>
                {(state.data?.pages || []).map((p) => (
                  <tr key={p.slug}>
                    <td>{p.title}<br /><small>{p.slug}</small></td>
                    <td>{p.published_at ? <DateText value={p.published_at} /> : <Badge tone="warn">never published</Badge>}</td>
                    <td>{p.version}</td>
                    <td><Button onClick={() => setSlug(p.slug)} aria-label={`Edit ${p.title}`}>Edit</Button></td>
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
