/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useEffect, useMemo, useState } from 'react';
import { useAction, useAdmin, useLoad, useNotice } from '../hooks.js';
import { ACCEPT_ATTRIBUTE, reencodeToWebp } from '../imageTools.js';
import { buildObjectName, formatBytes, nextVersion, parseCount, sanitizeBaseName, validateHttpsUrl } from '../helpers.js';
import { Badge, Button, Card, DateText, Field, LoadState, NoticeSlot, SelectInput, StatusBadge, TextInput, useConfirm } from '../ui.jsx';

const PROVENANCE_HELP = 'Approval needs the source name and the licence. Say honestly where the picture came from; do not approve a stand-in as if it were the real product.';

const IMAGE_COLUMNS = 'id, product_id, variant_id, bucket, path, kind, alt_text, width, height, sort_order, is_cover, source_name, source_url, licence, attribution, retrieved_on, approval_status, approved_at, checksum_sha256, created_at';

function provenanceValues(form) {
  const errors = {};
  const url = validateHttpsUrl(form.source_url, { label: 'Source link' });
  if (!url.ok) errors.source_url = url.reason;
  for (const key of ['source_name', 'licence', 'attribution']) if (form[key].length > 300) errors[key] = 'Keep it under 300 characters.';
  if (form.alt_text.length > 200) errors.alt_text = 'Alt text: 200 characters at most.';
  const order = parseCount(form.sort_order, { max: 100000 });
  if (!order.ok) errors.sort_order = order.reason;
  if (form.retrieved_on && !/^\d{4}-\d{2}-\d{2}$/.test(form.retrieved_on)) errors.retrieved_on = 'Use a real date.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      alt_text: form.alt_text.trim(), sort_order: order.value, source_name: form.source_name.trim() || null, source_url: url.value,
      licence: form.licence.trim() || null, attribution: form.attribution.trim() || null, retrieved_on: form.retrieved_on || null,
      kind: form.kind, variant_id: form.variant_id || null,
    },
  };
}

const imageToForm = (image) => ({
  alt_text: image.alt_text || '', sort_order: String(image.sort_order ?? 0), source_name: image.source_name || '', source_url: image.source_url || '',
  licence: image.licence || '', attribution: image.attribution || '', retrieved_on: image.retrieved_on || '', kind: image.kind, variant_id: image.variant_id || '',
});

function ImageCard({ image, previewUrl, variants, gateway, onChanged }) {
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const [dialog, ask] = useConfirm();
  const initial = useMemo(() => imageToForm(image), [image]);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const isPrivate = image.bucket === 'product-private';
  const provenanceOk = Boolean(image.source_name && image.licence);

  const save = async (event) => {
    event.preventDefault();
    const checked = provenanceValues(form);
    setErrors(checked.errors || {});
    if (!checked.ok) { notice.fail(new Error('Fix the highlighted fields.')); return; }
    const result = await run(() => gateway.query((db) => db.from('product_images').update(checked.value).eq('id', image.id)), 'Image details saved.');
    if (result.ok) onChanged();
  };
  const approve = async () => {
    const result = await run(() => gateway.fn('admin-approve-image', { image_id: image.id }), 'Approved and published to the storefront image store.');
    if (result.ok) onChanged();
  };
  const reject = () => ask({
    title: 'Reject this image?', body: <p>It stays private and can never be shown on the storefront. Upload a new version if you need a replacement.</p>,
    confirmLabel: 'Reject image', danger: true,
    action: async () => { const result = await run(() => gateway.rpc('admin_reject_image', { p_image_id: image.id }), 'Image rejected.'); if (result.ok) onChanged(); },
  });
  const makeCover = async () => {
    // One atomic server call: only an approved image can become the cover.
    const result = await run(() => gateway.rpc('admin_set_cover_image', { p_image_id: image.id }), 'Cover image set.');
    onChanged();
    return result;
  };
  const remove = () => ask({
    title: 'Delete this image?', body: <p>The record and the private file are deleted. This cannot be undone. Approved (public) images cannot be deleted here.</p>,
    confirmLabel: 'Delete image', danger: true,
    action: async () => {
      const result = await run(async () => {
        await gateway.query((db) => db.storage.from('product-private').remove([image.path]));
        await gateway.query((db) => db.from('product_images').delete().eq('id', image.id));
      }, 'Image deleted.');
      if (result.ok) onChanged();
    },
  });

  return (
    <article className="ovad-image">
      <div className="ovad-image-preview">
        {previewUrl ? <img src={previewUrl} alt={image.alt_text || ''} loading="lazy" width={image.width || undefined} height={image.height || undefined} /> : <span className="ovad-empty">No preview</span>}
      </div>
      <div className="ovad-image-body">
        <p className="ovad-row">
          <StatusBadge value={image.approval_status} />
          {image.is_cover ? <Badge tone="ok">cover</Badge> : null}
          <Badge tone="muted">{isPrivate ? 'private' : 'public'}</Badge>
          <small>{image.width && image.height ? `${image.width}×${image.height}` : ''} <DateText value={image.created_at} /></small>
        </p>
        <p><code className="ovad-path">{image.path}</code></p>
        <form className="ovad-form ovad-form-grid" onSubmit={save} aria-label={`Details for ${image.path}`}>
          <TextInput label="Alt text (describes the picture)" value={form.alt_text} onChange={set('alt_text')} error={errors.alt_text} maxLength={200} wide />
          <TextInput label="Order" value={form.sort_order} onChange={set('sort_order')} error={errors.sort_order} inputMode="numeric" />
          <SelectInput label="Type" value={form.kind} onChange={set('kind')} options={[{ value: 'photo', label: 'Photo' }, { value: 'cutout', label: 'Cut-out' }]} />
          <SelectInput label="Shows variant" value={form.variant_id} onChange={set('variant_id')} options={[{ value: '', label: 'Whole product' }, ...variants.map((v) => ({ value: v.id, label: v.sku }))]} />
          <TextInput label="Source name" value={form.source_name} onChange={set('source_name')} error={errors.source_name} hint="Who took or supplied it." />
          <TextInput label="Source link" value={form.source_url} onChange={set('source_url')} error={errors.source_url} placeholder="https://" />
          <TextInput label="Licence" value={form.licence} onChange={set('licence')} error={errors.licence} hint="For example “Own photograph” or the licence name." />
          <TextInput label="Attribution" value={form.attribution} onChange={set('attribution')} error={errors.attribution} />
          <TextInput label="Retrieved on" type="date" value={form.retrieved_on} onChange={set('retrieved_on')} error={errors.retrieved_on} />
          <div className="ovad-field-wide"><NoticeSlot notice={notice.notice} /></div>
          <div className="ovad-row ovad-field-wide">
            <Button type="submit" busy={busy} disabled={!dirty}>Save details</Button>
            {isPrivate && image.approval_status === 'unverified' ? (
              <Button tone="primary" busy={busy} disabled={dirty || !provenanceOk} onClick={approve}>Approve</Button>
            ) : null}
            {isPrivate && image.approval_status === 'unverified' ? <Button tone="danger" busy={busy} onClick={reject}>Reject</Button> : null}
            {!image.is_cover && image.approval_status === 'approved' ? <Button busy={busy} onClick={makeCover}>Set as cover</Button> : null}
            {image.approval_status !== 'approved' ? <Button tone="danger" busy={busy} onClick={remove}>Delete</Button> : null}
          </div>
          {isPrivate && image.approval_status === 'unverified' ? (
            <p className="ovad-note ovad-field-wide">{dirty ? 'Save the details before approving.' : provenanceOk ? 'Approving makes this picture public on the storefront.' : PROVENANCE_HELP}</p>
          ) : null}
        </form>
      </div>
      {dialog}
    </article>
  );
}

function UploadForm({ product, images, variants, gateway, onUploaded }) {
  const notice = useNotice();
  const { busy, run } = useAction(notice);
  const [prepared, setPrepared] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [fileKey, setFileKey] = useState(0);
  const existingPaths = useMemo(() => images.map((i) => i.path), [images]);
  const [form, setForm] = useState({ name: '', version: '', alt_text: '', variant_id: '', source_name: '', source_url: '', licence: '', attribution: '', retrieved_on: '' });
  const [errors, setErrors] = useState({});
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const suggestedVersion = nextVersion(existingPaths, product.slug);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const choose = async (event) => {
    const file = event.target.files?.[0];
    setPrepared(null);
    setPreviewUrl('');
    notice.clear();
    if (!file) return;
    setPreparing(true);
    try {
      const result = await reencodeToWebp(file);
      setPrepared({ ...result, fileName: file.name });
      setPreviewUrl(URL.createObjectURL(result.blob));
      setForm((f) => ({ ...f, name: f.name || sanitizeBaseName(file.name) }));
    } catch (error) {
      notice.fail(error);
    } finally {
      setPreparing(false);
    }
  };

  const upload = async (event) => {
    event.preventDefault();
    if (!prepared) { notice.fail(new Error('Choose a picture first.')); return; }
    const version = form.version === '' ? suggestedVersion : Number(form.version);
    const built = buildObjectName({ slug: product.slug, version, name: form.name });
    const meta = provenanceValues({ ...form, sort_order: String(images.length), kind: 'photo' });
    const nextErrors = { ...(meta.errors || {}) };
    if (!built.ok) nextErrors.name = built.reason;
    setErrors(nextErrors);
    if (!built.ok || !meta.ok) { notice.fail(new Error('Fix the highlighted fields.')); return; }
    const result = await run(async () => {
      const uploaded = await gateway.fn('admin-upload-image', undefined, { rawBody: prepared.blob, contentType: 'image/webp', query: { path: built.path } });
      try {
        await gateway.query((db) => db.from('product_images').insert({
          product_id: product.id, bucket: 'product-private', path: uploaded.path, kind: 'photo', width: uploaded.width, height: uploaded.height,
          checksum_sha256: uploaded.checksum_sha256, is_cover: false, approval_status: 'unverified', ...meta.value,
        }));
      } catch (error) {
        error.message = `The file was uploaded to private storage (${uploaded.path}) but its record could not be saved: ${error.message}`;
        throw error;
      }
      return uploaded;
    }, (uploaded) => `Uploaded ${formatBytes(uploaded.size)} to private storage. Review the details, then approve it.`);
    if (result.ok) {
      setPrepared(null);
      setPreviewUrl('');
      setFileKey((k) => k + 1);
      setForm((f) => ({ ...f, name: '', version: '', alt_text: '' }));
      onUploaded();
    }
  };

  return (
    <form className="ovad-form ovad-form-grid ovad-subform" onSubmit={upload} aria-label="Upload a picture">
      <Field label="Picture (JPEG, PNG or WebP)" hint="It is re-encoded here as WebP, at most 2000 pixels on the longest side. That removes camera and location data." wide>
        {(aria) => <input key={fileKey} {...aria} type="file" accept={ACCEPT_ATTRIBUTE} onChange={choose} />}
      </Field>
      {preparing ? <p className="ovad-loading field-wide" role="status">Preparing the picture…</p> : null}
      {prepared ? (
        <div className="ovad-field-wide ovad-prepared" role="status">
          <img src={previewUrl} alt="Preview of the prepared picture" />
          <p>
            Original {formatBytes(prepared.sourceBytes)}, {prepared.sourceWidth}×{prepared.sourceHeight}. Prepared WebP {formatBytes(prepared.blob.size)}, {prepared.width}×{prepared.height}
            {prepared.scaled ? ' (reduced to 2000 pixels)' : ''}. Metadata removed.
          </p>
        </div>
      ) : null}
      <TextInput label="File name" value={form.name} onChange={set('name')} error={errors.name} hint="Lower-case letters, digits, dash or underscore. “.webp” is added." />
      <TextInput label="Version" value={form.version} onChange={set('version')} error={errors.version} inputMode="numeric" placeholder={String(suggestedVersion)} hint={`Folder v${form.version || suggestedVersion}. Use a new version for a replacement picture; files are never overwritten.`} />
      <TextInput label="Alt text" value={form.alt_text} onChange={set('alt_text')} error={errors.alt_text} wide hint="Describe what is in the picture." />
      <SelectInput label="Shows variant" value={form.variant_id} onChange={set('variant_id')} options={[{ value: '', label: 'Whole product' }, ...variants.map((v) => ({ value: v.id, label: v.sku }))]} />
      <TextInput label="Source name" value={form.source_name} onChange={set('source_name')} error={errors.source_name} />
      <TextInput label="Source link" value={form.source_url} onChange={set('source_url')} error={errors.source_url} placeholder="https://" />
      <TextInput label="Licence" value={form.licence} onChange={set('licence')} error={errors.licence} />
      <TextInput label="Attribution" value={form.attribution} onChange={set('attribution')} error={errors.attribution} />
      <TextInput label="Retrieved on" type="date" value={form.retrieved_on} onChange={set('retrieved_on')} error={errors.retrieved_on} />
      <div className="ovad-field-wide"><NoticeSlot notice={notice.notice} /></div>
      <div className="ovad-row ovad-field-wide"><Button type="submit" tone="primary" busy={busy} disabled={!prepared}>Upload (stays private until approved)</Button></div>
    </form>
  );
}

export default function ProductImages({ product, onChanged }) {
  const { gateway } = useAdmin();
  const list = useLoad(async () => {
    const [images, variants] = await Promise.all([
      gateway.query((db) => db.from('product_images').select(IMAGE_COLUMNS).eq('product_id', product.id).order('sort_order').order('created_at')),
      gateway.query((db) => db.from('product_variants').select('id, sku').eq('product_id', product.id).order('sort_order')),
    ]);
    // Private pictures are shown through short-lived signed links; public ones through their public address.
    const privatePaths = images.filter((i) => i.bucket === 'product-private').map((i) => i.path);
    const urls = {};
    if (privatePaths.length) {
      const signed = await gateway.query((db) => db.storage.from('product-private').createSignedUrls(privatePaths, 3600));
      for (const item of signed || []) if (item.signedUrl) urls[item.path] = item.signedUrl;
    }
    for (const image of images) {
      if (image.bucket === 'product-public') urls[image.path] = gateway.client.storage.from('product-public').getPublicUrl(image.path).data.publicUrl;
    }
    return { images, variants, urls };
  }, [product.id]);

  const changed = () => { list.reload(); onChanged(); };
  const images = list.data?.images || [];
  const cover = images.find((i) => i.is_cover);

  return (
    <Card title="Pictures">
      <p className="ovad-note">
        New pictures are private until you approve them. Only an approved cover picture counts towards “ready to sell”.
        {cover ? '' : ' This product has no cover picture yet.'}
      </p>
      {list.data ? <UploadForm product={product} images={images} variants={list.data.variants} gateway={gateway} onUploaded={changed} /> : null}
      <LoadState loading={list.loading} error={list.error} data={list.data} onRetry={list.reload} empty={list.data && images.length === 0} emptyText="No pictures yet.">
        {list.data ? (
          <div className="ovad-images">
            {images.map((image) => (
              <ImageCard key={`${image.id}-${image.approval_status}-${image.is_cover}-${image.bucket}`} image={image} previewUrl={list.data.urls[image.path]} variants={list.data.variants} gateway={gateway} onChanged={changed} />
            ))}
          </div>
        ) : null}
      </LoadState>
    </Card>
  );
}
