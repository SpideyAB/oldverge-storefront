// Pure helpers for the live account, order-tracking and returns pages (no React, no network).

export const ORDER_NUMBER_RE = /^OV-\d{6}-[0-9A-F]{8}$/;
// The server issues 43-character base64url access codes (a 256-bit HMAC). Same shape check as the Edge Function.
export const ACCESS_CODE_RE = /^[A-Za-z0-9_-]{43}$/;

export const PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory', 'Gilgit-Baltistan', 'Azad Jammu and Kashmir'];
// Same shape the Edge Functions accept (supabase/functions/_shared/validate.js).
export const PHONE_RE = /^\+?[0-9][0-9 ()-]{3,28}[0-9]$/;
export const MAX_ADDRESSES = 10;
export const PAGE_SIZE = 10;

const safeDecode = (value) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

/** Pulls `o=<order number>` and `t=<access code>` out of a pasted confirmation link or hash. null when either is missing. */
export function extractFromLink(text) {
  const source = String(text ?? '');
  const order = /(?:^|[#?&\s])o=([^&#\s]+)/.exec(source);
  const token = /(?:^|[#?&\s])t=([^&#\s]+)/.exec(source);
  if (!order || !token) return null;
  return { orderNumber: safeDecode(order[1]).trim().toUpperCase(), accessCode: safeDecode(token[1]).trim() };
}

/**
 * Reads the two fields of the track form. Either field may contain the whole confirmation link.
 * Returns { ok, orderNumber, accessCode, errors } where errors is keyed by field name.
 */
export function parseTrackInput(orderField, codeField) {
  const rawOrder = String(orderField ?? '').trim();
  const rawCode = String(codeField ?? '').trim();
  const fromLink = extractFromLink(rawOrder) || extractFromLink(rawCode) || extractFromLink(`${rawOrder} ${rawCode}`);
  const orderNumber = (fromLink ? fromLink.orderNumber : rawOrder).toUpperCase();
  const accessCode = fromLink ? fromLink.accessCode : rawCode;
  const errors = {};
  if (!orderNumber) errors.orderNumber = 'Enter your order number.';
  else if (!ORDER_NUMBER_RE.test(orderNumber)) errors.orderNumber = 'Enter the order number exactly as shown in your confirmation, for example OV-261019-1A2B3C4D.';
  if (!accessCode) errors.accessCode = 'Enter your access code, or paste the whole link from your confirmation.';
  else if (!ACCESS_CODE_RE.test(accessCode)) errors.accessCode = 'That access code does not look right. Copy it again from your confirmation.';
  return { ok: Object.keys(errors).length === 0, orderNumber, accessCode, errors };
}

/** Honest, generic wording for a failed order-status call. Never says whether an order exists. */
export function describeLookupFailure(result) {
  const status = Number(result?.status) || 0;
  const code = result?.data?.error;
  if (code === 'backend_not_configured') return { kind: 'unavailable', message: 'Order lookup is not available on this site yet.' };
  if (status === 404) return { kind: 'not_found', message: 'We could not find that order. Check the order number and access code and try again.' };
  if (status === 429) return { kind: 'rate_limited', message: 'Too many tries. Please wait a minute and try again.' };
  if (status === 0) return { kind: 'network', message: 'We could not reach the server. Check your connection and try again.' };
  return { kind: 'unavailable', message: 'Order lookup is not available right now. Please try again later.' };
}

/** Only same-site account paths are accepted as a post-login destination. */
export function safeNext(value, fallback = '/account') {
  if (typeof value !== 'string') return fallback;
  if (!/^\/account(?:[/?#]|$)/.test(value) || value.startsWith('//') || value.includes('\\') || /[\r\n]/.test(value)) return fallback;
  return value;
}

export const loginPath = (next) => `/account/login?next=${encodeURIComponent(next)}`;

/** Only http(s) links are ever rendered as links (never javascript: or data:). */
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export const safeSlug = (value) => (typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : null);

export function splitName(full) {
  const clean = String(full ?? '').trim().replace(/\s+/g, ' ');
  const index = clean.indexOf(' ');
  return index === -1 ? { first: clean, last: '' } : { first: clean.slice(0, index), last: clean.slice(index + 1) };
}

export function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
export function formatDateTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const FULFILMENT_LABELS = {
  unfulfilled: 'Order received', processing: 'Being prepared', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};
export const PAYMENT_LABELS = {
  unpaid: 'Unpaid', pending: 'Payment pending', paid: 'Paid', failed: 'Payment failed', refunded: 'Refunded', partially_refunded: 'Partly refunded',
};
export const fulfilmentLabel = (value) => FULFILMENT_LABELS[value] || String(value || '');
export const paymentLabel = (value) => PAYMENT_LABELS[value] || String(value || '');

export function humaniseKind(kind) {
  const text = String(kind || '').replace(/[_-]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Update';
}

/** Tax wording that never claims a tax was calculated when it was not. */
export function taxLine(order) {
  if (order?.tax_status === 'included') return { label: 'Tax (included in prices)', amount: Number(order.tax_pkr) || 0 };
  if (order?.tax_status === 'added') return { label: 'Tax', amount: Number(order.tax_pkr) || 0 };
  return { label: 'Taxes', text: 'Taxes not calculated' };
}

/**
 * Turns a row read from public.orders (+ order_items + order_events) into the same shape as the customer-safe
 * projection (public.order_projection) so one view renders both. The signed-in owner sees their full e-mail.
 */
export function toProjection(row) {
  if (!row) return null;
  const items = [...(row.order_items || [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const events = [...(row.order_events || [])]
    .filter((event) => event.visible_to_customer !== false)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return {
    order_number: row.order_number,
    placed_at: row.placed_at,
    customer_name: row.customer_name,
    email_hint: row.customer_email,
    shipping_address: row.shipping_address,
    currency: row.currency,
    subtotal_pkr: row.subtotal_pkr,
    shipping_pkr: row.shipping_pkr,
    tax_pkr: row.tax_pkr,
    tax_status: row.tax_status,
    total_pkr: row.total_pkr,
    payment_method: row.payment_method_label,
    payment_status: row.payment_status,
    fulfilment_status: row.fulfilment_status,
    shipping_method: row.shipping_method_label,
    tracking_carrier: row.tracking_carrier,
    tracking_number: row.tracking_number,
    tracking_url: row.tracking_url,
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
    items: items.map((item) => ({
      product_slug: item.product_slug, product_name: item.product_name, sku: item.sku, color: item.color, size: item.size,
      unit_price_pkr: item.unit_price_pkr, quantity: item.quantity, line_total_pkr: item.line_total_pkr, image_path: item.image_path,
    })),
    events: events.map((event) => ({ kind: event.kind, message: event.message, created_at: event.created_at })),
  };
}

// ---------------------------------------------------------------- address form validation
export const BLANK_ADDRESS = { label: 'Home', recipient: '', phone: '', line1: '', line2: '', city: '', province: '', postal_code: '', is_default: false };

/** Field limits match the CHECK constraints on public.addresses. */
export function validateAddress(values) {
  const errors = {};
  const text = (key) => String(values[key] ?? '').trim();
  if (!text('label')) errors.label = 'Give this address a short label, for example Home.';
  else if (text('label').length > 40) errors.label = 'Use 40 characters or fewer.';
  if (!text('recipient')) errors.recipient = 'Enter the name of the person receiving the parcel.';
  else if (text('recipient').length > 120) errors.recipient = 'Use 120 characters or fewer.';
  if (!text('phone')) errors.phone = 'Enter a phone number for the courier.';
  else if (!PHONE_RE.test(text('phone'))) errors.phone = 'Enter a valid phone number, for example 0300 1234567.';
  if (!text('line1')) errors.line1 = 'Enter the street address.';
  else if (text('line1').length > 200) errors.line1 = 'Use 200 characters or fewer.';
  if (text('line2').length > 200) errors.line2 = 'Use 200 characters or fewer.';
  if (!text('city')) errors.city = 'Enter the city.';
  else if (text('city').length > 80) errors.city = 'Use 80 characters or fewer.';
  if (!text('province')) errors.province = 'Select a province or territory.';
  if (text('postal_code') && !/^\d{5}$/.test(text('postal_code'))) errors.postal_code = 'Postal codes in Pakistan have 5 digits. Leave this blank if you are not sure.';
  return errors;
}

/** Only the columns the customer is granted to write. */
export function addressPayload(values) {
  const text = (key) => String(values[key] ?? '').trim();
  return {
    label: text('label'), recipient: text('recipient'), phone: text('phone'), line1: text('line1'), line2: text('line2'),
    city: text('city'), province: text('province'), postal_code: text('postal_code'), is_default: Boolean(values.is_default),
  };
}

export function validateProfile(values) {
  const errors = {};
  const name = String(values.display_name ?? '').trim();
  const phone = String(values.phone ?? '').trim();
  if (name.length > 80) errors.display_name = 'Use 80 characters or fewer.';
  if (phone && !PHONE_RE.test(phone)) errors.phone = 'Enter a valid phone number, or leave this blank.';
  return errors;
}

/** Honest wording for a failed submit-contact call (return requests). */
export function describeContactFailure(result) {
  const status = Number(result?.status) || 0;
  const code = result?.data?.error;
  if (code === 'backend_not_configured') return 'Return requests are not available on this site yet.';
  if (status === 429) return 'Too many requests. Please wait a few minutes and try again.';
  if (status === 400 && code === 'bot_check_failed') return 'The security check did not pass. Please try again later.';
  if (status === 400) return 'We could not accept those details. Check them and try again.';
  if (status === 0) return 'We could not reach the server. Your request was not saved. Check your connection and try again.';
  return 'Your request could not be saved right now. Please try again later.';
}

/** Validation for the return-request form. */
export function validateReturnRequest(values, emailError) {
  const errors = {};
  if (!String(values.name ?? '').trim()) errors.name = 'Enter your name.';
  else if (String(values.name).trim().length > 160) errors.name = 'Use 160 characters or fewer.';
  const order = String(values.order_number ?? '').trim().toUpperCase();
  if (!order) errors.order_number = 'Enter your order number.';
  else if (!ORDER_NUMBER_RE.test(order)) errors.order_number = 'Enter the order number exactly as shown in your confirmation, for example OV-261019-1A2B3C4D.';
  if (emailError) errors.email = emailError;
  const message = String(values.message ?? '').trim();
  if (!message) errors.message = 'Tell us which item this is about, what you would like to do and why.';
  else if (message.length > 4000) errors.message = 'Use 4000 characters or fewer.';
  return errors;
}
