// Turns backend failures into short, honest sentences. Database errors are raised as `ov_error:<code>` (SQLSTATE P0001,
// optional JSON in the error detail); Edge Functions answer `{ error: '<code>', details? }`. Raw database text is never
// shown, because it can name tables and columns. Unknown failures say so instead of pretending to be something else.

/** Plain-English names for the readiness / publishing problem codes the SQL returns. */
export const PROBLEM_TEXT = {
  no_active_variant: 'it has no active variant (SKU, price)',
  price_missing: 'an active variant has no price above PKR 0',
  stock_not_verified: 'stock has not been counted and confirmed for every active variant',
  no_approved_cover_image: 'there is no approved cover image',
  category_inactive: 'its category is switched off',
  new_product_cannot_be_ready: 'a brand-new product cannot be marked ready to sell',
  product_not_found: 'the product was not found',
  no_enabled_payment_method: 'no payment method is enabled',
  no_enabled_shipping_rate: 'no shipping method with an enabled rate is available',
  no_purchasable_product: 'no published product is marked ready to sell with confirmed stock and a price',
  no_contact_channel: 'no public contact email, phone or WhatsApp number is set',
  policies_not_published: 'shipping, returns, privacy and terms policies have not all been published by an admin',
};

export const describeProblem = (code) => PROBLEM_TEXT[code] || String(code).replace(/_/g, ' ');

export const describeProblems = (problems) => (Array.isArray(problems) ? problems : []).map(describeProblem);

const MESSAGES = {
  forbidden: 'Your account does not have admin access.',
  owner_only: 'Only the store owner can do that.',
  invalid_request: 'Some of the information is missing or not valid. Check the form and try again.',
  invalid_field: 'One of the fields is not valid.',
  invalid_quantity: 'That quantity is not allowed.',
  invalid_transition: 'That change is not allowed from the current state.',
  payment_not_settled: 'The payment is not settled yet, so this order cannot move on.',
  not_found: 'That record no longer exists. Reload the page.',
  variant_unavailable: 'That variant is not available.',
  below_reserved: 'The count cannot be lower than the stock already reserved for open orders.',
  provenance_required: 'Record the image source name and licence before approving it.',
  only_drafts_can_be_deleted: 'Only draft products can be deleted. Archive anything that has been published.',
  product_has_orders: 'This product appears on existing orders, so it cannot be deleted. Archive it instead.',
  not_ready_for_ordering: 'The store is not ready to take orders.',
  not_ready_to_sell: 'The product cannot be marked ready to sell yet.',
  not_publishable: 'The product cannot be published yet.',
  use_admin_set_ordering_enabled: 'Ordering can only be changed with the ordering switch.',
  protected_setting: 'That setting is protected.',
  append_only: 'That history record cannot be changed.',
  nothing_to_refund: 'This order has no paid amount to refund.',
  refund_exceeds_total: 'The refund would be more than the order total (counting refunds already confirmed or requested).',
  policy_draft_empty: 'The policy draft is empty. Add at least one section and save it first.',
  too_many_addresses: 'There are too many saved addresses.',
  ordering_closed: 'Ordering is closed.',
  // Edge Function answers
  authentication_required: 'Your session has ended. Sign in again.',
  invalid_session: 'Your session has ended. Sign in again.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  payload_too_large: 'The file is too large (10 MB at most).',
  unsupported_image: 'That file is not a supported image (JPEG, PNG or WebP).',
  type_mismatch: 'The image type does not match its name.',
  invalid_path: 'The image file name or folder is not allowed.',
  invalid_dimensions: 'The image is too small or too large (16 to 8000 pixels on each side).',
  metadata_not_stripped: 'The image still contains embedded metadata. Re-encode it and try again.',
  upload_failed: 'The upload failed. A file with this name and version may already exist; use the next version number.',
  already_public: 'That image is already public.',
  object_missing: 'The uploaded file could not be found in storage.',
  copy_failed: 'The image could not be copied to public storage. Nothing was published.',
  network_error: 'Could not reach the server. Check your connection and try again.',
  backend_not_configured: 'The store backend is not configured.',
  invalid_response: 'The server sent an answer that could not be read.',
  internal: 'The server had an internal error. Nothing was confirmed; reload and check before trying again.',
  method_not_allowed: 'The server refused that request.',
};

const SQLSTATE_MESSAGES = {
  '23505': 'That value is already used by another record (for example a duplicate SKU, slug or option combination).',
  '23514': 'A value is outside the allowed range or format.',
  '23503': 'That record is still linked to other records.',
  '23502': 'A required value is missing.',
  '22P02': 'A value has the wrong format.',
  '42501': 'Your account is not allowed to do that.',
};

const parseDetails = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};

/** Pulls the machine code and structured details out of whatever the backend threw or returned. */
export function readError(raw) {
  if (!raw) return { code: null, details: null, status: null, sqlstate: null, field: null };
  if (typeof raw === 'string') {
    const m = /ov_error:([a-z_0-9]+)/.exec(raw);
    return { code: m ? m[1] : raw, details: null, status: null, sqlstate: null, field: null };
  }
  const fromMessage = /ov_error:([a-z_0-9]+)/.exec(String(raw.message || ''));
  const fnCode = typeof raw.error === 'string' ? raw.error : null;
  return {
    code: fromMessage ? fromMessage[1] : fnCode,
    details: parseDetails(raw.details),
    status: typeof raw.status === 'number' ? raw.status : null,
    sqlstate: typeof raw.code === 'string' && /^[0-9A-Z]{5}$/.test(raw.code) ? raw.code : null,
    field: typeof raw.field === 'string' ? raw.field : null,
    jwt: /jwt|token.*expired/i.test(String(raw.message || '')),
  };
}

const list = (items) => items.join('; ');

/** One short sentence for people. */
export function describeError(raw) {
  const { code, details, sqlstate, field, status, jwt } = readError(raw);
  if (jwt || (status === 401 && !code)) return 'Your session has ended. Sign in again.';
  if (code && MESSAGES[code]) {
    const base = MESSAGES[code];
    if (['not_ready_to_sell', 'not_publishable', 'not_ready_for_ordering'].includes(code) && Array.isArray(details) && details.length) {
      return `${base} Missing: ${list(describeProblems(details))}.`;
    }
    if (code === 'below_reserved' && details && Number.isInteger(details.reserved)) {
      return `${base} Currently reserved: ${details.reserved}.`;
    }
    if (code === 'invalid_transition' && details && (details.from || details.to)) {
      return `${base}${details.from ? ` (now: ${details.from}${details.to ? `, requested: ${details.to}` : ''})` : ''}`;
    }
    if (code === 'invalid_field' && field) return `${base} (${field})`;
    return base;
  }
  if (sqlstate && SQLSTATE_MESSAGES[sqlstate]) return SQLSTATE_MESSAGES[sqlstate];
  if (code) return `The request was refused (${code}).`;
  return 'Something went wrong and the request did not complete. Reload and check the current state before trying again.';
}

/** Error thrown by the admin data layer. `message` is already a sentence people can read. */
export class AdminError extends Error {
  constructor(raw) {
    super(describeError(raw));
    this.name = 'AdminError';
    const info = readError(raw);
    this.code = info.code;
    this.details = info.details;
    this.status = info.status;
    this.sqlstate = info.sqlstate;
    // Not an admin any more (or never was): go back to the access-denied screen.
    this.forbidden = info.code === 'forbidden' || (info.status === 403 && info.code === 'forbidden');
    // The session or the membership may have changed: the caller must re-check who this is.
    this.recheck = !this.forbidden && info.code !== 'owner_only' && (
      info.sqlstate === '42501' || info.status === 401 || info.code === 'authentication_required' || info.code === 'invalid_session' || Boolean(info.jwt)
    );
  }
}

export const isAdminError = (error) => error instanceof AdminError;
