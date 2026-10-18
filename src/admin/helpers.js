// Pure helpers for the admin area: validation that mirrors the database constraints (so mistakes are caught before a
// request), image naming and resize planning, date ranges and small state tables. No React, no network.

// ---------------------------------------------------------------- money and codes
/**
 * Whole PKR only. Accepts a digit string or an integer; rejects decimals, negatives, separators and exponents.
 * Returns { ok: true, value } or { ok: false, reason }.
 */
export function parsePkr(input, { min = 0, max = 100000000 } = {}) {
  if (typeof input === 'number') {
    if (!Number.isInteger(input)) return { ok: false, reason: 'Enter a whole number of rupees, without decimals.' };
    if (input < min) return { ok: false, reason: input < 0 ? 'The amount cannot be negative.' : `The amount must be at least PKR ${min}.` };
    if (input > max) return { ok: false, reason: `The amount cannot be more than PKR ${max}.` };
    return { ok: true, value: input };
  }
  const text = String(input ?? '').trim();
  if (text === '') return { ok: false, reason: 'Enter an amount.' };
  if (/^-/.test(text)) return { ok: false, reason: 'The amount cannot be negative.' };
  if (/[.,]/.test(text)) return { ok: false, reason: 'Enter a whole number of rupees, without decimals or separators.' };
  if (!/^\d{1,10}$/.test(text)) return { ok: false, reason: 'Use digits only.' };
  return parsePkr(Number(text), { min, max });
}

/** Whole non-negative count (stock, sort order, threshold). Negative values are allowed only with allowNegative. */
export function parseCount(input, { min = 0, max = 1000000, allowNegative = false } = {}) {
  const text = String(input ?? '').trim();
  const pattern = allowNegative ? /^-?\d{1,9}$/ : /^\d{1,9}$/;
  if (!pattern.test(text)) return { ok: false, reason: allowNegative ? 'Enter a whole number.' : 'Enter a whole number, zero or more.' };
  const value = Number(text);
  if (value < min) return { ok: false, reason: `The number must be at least ${min}.` };
  if (value > max) return { ok: false, reason: `The number cannot be more than ${max}.` };
  return { ok: true, value };
}

export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export function validateSku(sku) {
  const value = String(sku ?? '').trim();
  if (!SKU_PATTERN.test(value)) return { ok: false, reason: 'SKU: 3 to 40 characters, letters, digits, dot, dash or underscore, starting with a letter or digit.' };
  return { ok: true, value };
}

export function validateSlug(slug) {
  const value = String(slug ?? '').trim();
  if (!SLUG_PATTERN.test(value) || value.length > 80) return { ok: false, reason: 'Slug: lower-case words joined by single dashes, 80 characters at most.' };
  return { ok: true, value };
}

export const slugify = (text) => String(text ?? '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '');

export const isHexColour = (value) => HEX_PATTERN.test(String(value ?? ''));

/** Returns { ok, value, errors } for the variant form. Empty optional fields become null. */
export function validateVariant(form) {
  const errors = {};
  const sku = validateSku(form.sku);
  if (!sku.ok) errors.sku = sku.reason;
  const price = parsePkr(form.price_pkr);
  if (!price.ok) errors.price_pkr = price.reason;
  const colourName = String(form.color_name ?? '').trim();
  if (colourName.length > 40) errors.color_name = 'Colour name: 40 characters at most.';
  const hex = String(form.color_hex ?? '').trim();
  if (hex && !isHexColour(hex)) errors.color_hex = 'Colour code looks like #1A2B3C.';
  const size = String(form.size_label ?? '').trim();
  if (size.length > 20) errors.size_label = 'Size: 20 characters at most.';
  const order = parseCount(form.sort_order === '' || form.sort_order === undefined ? 0 : form.sort_order, { max: 100000 });
  if (!order.ok) errors.sort_order = order.reason;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    errors,
    value: {
      sku: sku.value, price_pkr: price.value, color_name: colourName || null, color_hex: hex || null,
      size_label: size || null, sort_order: order.value, active: Boolean(form.active),
    },
  };
}

// ---------------------------------------------------------------- images
export const MAX_IMAGE_SIDE = 2000;
export const WEBP_QUALITY = 0.86;
const OBJECT_NAME = /^[a-z0-9][a-z0-9_.-]{0,80}$/;

/** Lower-case file base name safe for the storage path: letters, digits, dash, underscore, dot. */
export function sanitizeBaseName(filename) {
  const withoutExtension = String(filename ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const cleaned = slugify(withoutExtension).slice(0, 60).replace(/-+$/g, '');
  return cleaned || 'image';
}

/** products/<slug>/v<N>/<name>.webp: the shape the upload function accepts. Returns { ok, path } or { ok:false, reason }. */
export function buildObjectName({ slug, version, name }) {
  const s = validateSlug(slug);
  if (!s.ok) return { ok: false, reason: 'The product needs a valid slug before images can be uploaded.' };
  if (!Number.isInteger(version) || version < 1 || version > 9999) return { ok: false, reason: 'Version must be a whole number from 1 to 9999.' };
  const base = String(name ?? '').trim().toLowerCase();
  if (!OBJECT_NAME.test(base) || base.includes('..')) return { ok: false, reason: 'File name: lower-case letters, digits, dash, underscore or dot, up to 81 characters.' };
  return { ok: true, path: `products/${s.value}/v${version}/${base}.webp` };
}

export const isValidImagePath = (path) => /^(products|site)\/[a-z0-9]+(-[a-z0-9]+)*(\/v[0-9]{1,4})?\/[a-z0-9][a-z0-9_.-]{0,80}\.(jpg|jpeg|png|webp)$/.test(String(path)) && !String(path).includes('..');

/** Next unused version number for a product, from the image paths it already has. */
export function nextVersion(paths, slug) {
  let highest = 0;
  const prefix = `products/${slug}/v`;
  for (const path of paths || []) {
    if (typeof path !== 'string' || !path.startsWith(prefix)) continue;
    const match = /^(\d{1,4})\//.exec(path.slice(prefix.length));
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return Math.min(highest + 1, 9999);
}

/**
 * Plans the in-browser re-encode. Never upscales. The longest side is limited to `max`, keeping the aspect ratio.
 * The server accepts 16 to 8000 pixels per side, so tiny sources and absurd sources are refused before any work.
 */
export function planResize(width, height, max = MAX_IMAGE_SIDE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { ok: false, reason: 'The image has no readable size.' };
  if (Math.min(width, height) < 16) return { ok: false, reason: 'The image is too small (16 pixels minimum on each side).' };
  if (Math.max(width, height) > 20000) return { ok: false, reason: 'The image is too large to process in the browser.' };
  const scale = Math.min(1, max / Math.max(width, height));
  const out = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  if (Math.min(out.width, out.height) < 16) return { ok: false, reason: 'After resizing the image would be too narrow. Crop it first.' };
  return { ok: true, ...out, scaled: scale < 1 };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function validateHttpsUrl(value, { required = false, label = 'Link' } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return required ? { ok: false, reason: `${label} is required.` } : { ok: true, value: null };
  if (text.length > 250 || /\s/.test(text)) return { ok: false, reason: `${label} must be a single link of 250 characters at most.` };
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return { ok: false, reason: `${label} must start with https://` };
    return { ok: true, value: text };
  } catch {
    return { ok: false, reason: `${label} is not a valid link.` };
  }
}

// ---------------------------------------------------------------- operation keys and dates
/** Operation key for idempotent admin writes: replaying the same key does nothing the second time. */
export function newOpKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `adm-${crypto.randomUUID()}`;
  return `adm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const pad = (n) => String(n).padStart(2, '0');
export const toDateInput = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function defaultRange(days = 30, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { from: toDateInput(from), to: toDateInput(now) };
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Start of the given local day as an ISO timestamp, or null if the text is not a real date. */
export function dayStartIso(text) {
  const m = DATE_PATTERN.exec(String(text ?? ''));
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return date.getMonth() === Number(m[2]) - 1 ? date.toISOString() : null;
}
/** Last millisecond of the given local day as an ISO timestamp. */
export function dayEndIso(text) {
  const m = DATE_PATTERN.exec(String(text ?? ''));
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return date.getMonth() === Number(m[2]) - 1 ? date.toISOString() : null;
}

export function validateRange(from, to) {
  const start = dayStartIso(from); const end = dayEndIso(to);
  if (!start || !end) return { ok: false, reason: 'Choose a valid start and end date.' };
  if (start > end) return { ok: false, reason: 'The start date must be on or before the end date.' };
  return { ok: true, from: start, to: end };
}

// ---------------------------------------------------------------- order state tables (mirror the SQL; the server decides)
export const NEXT_FULFILMENT = { unfulfilled: 'processing', processing: 'shipped', shipped: 'delivered' };
export const canCancel = (order) => ['unfulfilled', 'processing'].includes(order.fulfilment_status);
export const RETURN_NEXT = { requested: ['approved', 'rejected'], approved: ['received'], rejected: ['closed'], received: ['closed'] };

/** How much more can be refunded: order total minus refunds already confirmed or still open. */
export function refundCeiling(order, refunds) {
  const used = (refunds || []).filter((r) => r.status === 'confirmed' || r.status === 'requested').reduce((sum, r) => sum + r.amount_pkr, 0);
  return Math.max(0, (order?.total_pkr ?? 0) - used);
}

export const canRequestRefund = (order) => ['paid', 'partially_refunded'].includes(order?.payment_status);

// ---------------------------------------------------------------- policy sections ({ heading, body: [paragraph] })
export const textToParagraphs = (text) => String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
export const paragraphsToText = (paragraphs) => (Array.isArray(paragraphs) ? paragraphs : []).join('\n\n');

export function normalizeSections(value) {
  if (!Array.isArray(value)) return [];
  return value.map((section) => ({
    heading: typeof section?.heading === 'string' ? section.heading : '',
    body: Array.isArray(section?.body) ? section.body.filter((p) => typeof p === 'string') : [],
  }));
}

/** Drafts are edited as { heading, text }. This converts back to what the database stores. */
export const sectionsToStored = (editable) => editable
  .map((section) => ({ heading: section.heading.trim(), body: textToParagraphs(section.text) }))
  .filter((section) => section.heading || section.body.length);

export function validateSections(stored) {
  if (!stored.length) return { ok: false, reason: 'Add at least one section.' };
  for (const [index, section] of stored.entries()) {
    if (!section.heading) return { ok: false, reason: `Section ${index + 1} needs a heading.` };
    if (section.heading.length > 160) return { ok: false, reason: `Section ${index + 1}: the heading is longer than 160 characters.` };
    if (!section.body.length) return { ok: false, reason: `Section "${section.heading}" has no text.` };
    if (section.body.some((p) => p.length > 4000)) return { ok: false, reason: `Section "${section.heading}" has a paragraph longer than 4000 characters.` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- public contact settings
export const CONTACT_KEYS = ['contact.email', 'contact.phone', 'contact.whatsapp', 'contact.instagram', 'contact.address'];

/** Cleared fields are stored as "" (a client cannot write JSON null into the value column). */
export function validateContactValue(key, input) {
  const value = String(input ?? '').trim();
  if (value.length > 300) return { ok: false, reason: 'Keep it under 300 characters.' };
  if (!value) return { ok: true, value: '' };
  if (key === 'contact.email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return { ok: false, reason: 'Enter a valid email address.' };
  if ((key === 'contact.phone' || key === 'contact.whatsapp') && !/^\+?[0-9][0-9\s-]{6,20}$/.test(value)) return { ok: false, reason: 'Enter digits only, with an optional leading +.' };
  if (key === 'contact.instagram' && !/^(@?[A-Za-z0-9._]{1,30}|https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._/-]{1,80})$/.test(value)) return { ok: false, reason: 'Enter a handle such as @oldverge or an https://instagram.com link.' };
  return { ok: true, value };
}

export const settingText = (value) => (typeof value === 'string' ? value : '');

// ---------------------------------------------------------------- shipping forms
export const CODE_PATTERN = /^[a-z0-9_]+$/;
export function validateCode(code) {
  const value = String(code ?? '').trim();
  if (!CODE_PATTERN.test(value) || value.length > 40) return { ok: false, reason: 'Code: lower-case letters, digits and underscores only.' };
  return { ok: true, value };
}

/** "Sindh, Punjab" -> ['Sindh','Punjab']; empty -> null (every province). */
export function parseProvinces(text) {
  const items = String(text ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  return items.length ? [...new Set(items)] : null;
}
export const provincesToText = (provinces) => (Array.isArray(provinces) ? provinces.join(', ') : '');

export const shortId = (id) => String(id ?? '').slice(0, 8);
