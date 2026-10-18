import { describe, expect, it } from 'vitest';
import {
  addressPayload, describeContactFailure, describeLookupFailure, extractFromLink, parseTrackInput, safeHttpUrl, safeNext, safeSlug, splitName,
  taxLine, toProjection, validateAddress, validateProfile, validateReturnRequest,
} from './helpers.js';

const NUMBER = 'OV-261019-1A2B3C4D';
const CODE = `${'A'.repeat(20)}_-${'b'.repeat(21)}`; // 43 base64url characters

describe('parseTrackInput', () => {
  it('accepts a separate number and code, normalising the number', () => {
    expect(parseTrackInput(' ov-261019-1a2b3c4d ', CODE)).toMatchObject({ ok: true, orderNumber: NUMBER, accessCode: CODE });
  });

  it('extracts both values from a pasted confirmation link in either box', () => {
    const link = `https://oldverge.example/pages/track-order#o=${NUMBER}&t=${CODE}`;
    expect(parseTrackInput(link, '')).toMatchObject({ ok: true, orderNumber: NUMBER, accessCode: CODE });
    expect(parseTrackInput('', link)).toMatchObject({ ok: true, orderNumber: NUMBER, accessCode: CODE });
    expect(parseTrackInput(`#o=${NUMBER}&t=${CODE}`, '')).toMatchObject({ ok: true });
    expect(parseTrackInput(`https://x.example/track?o=${NUMBER}&t=${CODE}`, '')).toMatchObject({ ok: true });
  });

  it('never accepts an order number alone', () => {
    const result = parseTrackInput(NUMBER, '');
    expect(result.ok).toBe(false);
    expect(result.errors.accessCode).toBeTruthy();
  });

  it('never accepts an email address in place of the access code', () => {
    const result = parseTrackInput(NUMBER, 'someone@example.com');
    expect(result.ok).toBe(false);
    expect(result.errors.accessCode).toBeTruthy();
  });

  it('explains malformed order numbers and empty input', () => {
    expect(parseTrackInput('12345', CODE).errors.orderNumber).toMatch(/exactly as shown/);
    expect(parseTrackInput('', '').errors).toEqual({ orderNumber: 'Enter your order number.', accessCode: expect.any(String) });
  });
});

describe('extractFromLink', () => {
  it('returns null unless both parts are present', () => {
    expect(extractFromLink(`#o=${NUMBER}`)).toBeNull();
    expect(extractFromLink('nothing here')).toBeNull();
    expect(extractFromLink(undefined)).toBeNull();
  });
  it('decodes percent-encoding safely', () => {
    expect(extractFromLink('#o=OV%2D261019%2D1A2B3C4D&t=abc')).toEqual({ orderNumber: NUMBER, accessCode: 'abc' });
    expect(extractFromLink('#o=%E0%A4%A&t=abc')).toMatchObject({ accessCode: 'abc' });
  });
});

describe('describeLookupFailure', () => {
  it('is generic for 404 and honest for the other cases', () => {
    expect(describeLookupFailure({ status: 404, data: { error: 'not_found' } })).toMatchObject({ kind: 'not_found', message: expect.stringMatching(/could not find that order/i) });
    expect(describeLookupFailure({ status: 429 })).toMatchObject({ kind: 'rate_limited' });
    expect(describeLookupFailure({ status: 0, data: { error: 'network_error' } })).toMatchObject({ kind: 'network' });
    expect(describeLookupFailure({ status: 0, data: { error: 'backend_not_configured' } })).toMatchObject({ kind: 'unavailable' });
    expect(describeLookupFailure({ status: 503, data: { error: 'not_configured' } })).toMatchObject({ kind: 'unavailable' });
  });
  it('never says what was wrong with a 404', () => {
    const { message } = describeLookupFailure({ status: 404 });
    expect(message).not.toMatch(/expired|revoked|wrong code/i);
  });
});

describe('describeContactFailure', () => {
  it('covers rate limit, network, validation and not-configured', () => {
    expect(describeContactFailure({ status: 429 })).toMatch(/Too many/);
    expect(describeContactFailure({ status: 0, data: { error: 'network_error' } })).toMatch(/not saved/);
    expect(describeContactFailure({ status: 400, data: { error: 'invalid_field' } })).toMatch(/Check them/);
    expect(describeContactFailure({ status: 0, data: { error: 'backend_not_configured' } })).toMatch(/not available/);
    expect(describeContactFailure({ status: 500 })).toMatch(/try again later/);
  });
});

describe('safeNext', () => {
  it('only allows paths under /account', () => {
    expect(safeNext('/account/orders?page=2')).toBe('/account/orders?page=2');
    expect(safeNext('/account')).toBe('/account');
    for (const bad of ['//evil.example', 'https://evil.example', '/accountant', '/shop', '/account\\..\\x', '/account/\r\nX', null, undefined]) {
      expect(safeNext(bad)).toBe('/account');
    }
  });
});

describe('url and slug guards', () => {
  it('renders only http(s) links', () => {
    expect(safeHttpUrl('https://courier.example/t/123')).toBe('https://courier.example/t/123');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,hi')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
  it('accepts plain slugs only', () => {
    expect(safeSlug('quarter-zip-olive')).toBe('quarter-zip-olive');
    expect(safeSlug('../x')).toBeNull();
    expect(safeSlug('A b')).toBeNull();
  });
});

describe('splitName', () => {
  it('splits at the first space', () => {
    expect(splitName('Ada')).toEqual({ first: 'Ada', last: '' });
    expect(splitName('  Ada   Byron  King ')).toEqual({ first: 'Ada', last: 'Byron King' });
  });
});

describe('taxLine', () => {
  it('is honest about uncalculated tax', () => {
    expect(taxLine({ tax_status: 'not_calculated', tax_pkr: 0 })).toEqual({ label: 'Taxes', text: 'Taxes not calculated' });
    expect(taxLine({ tax_status: 'included', tax_pkr: 120 })).toMatchObject({ amount: 120, label: expect.stringMatching(/included/) });
    expect(taxLine({ tax_status: 'added', tax_pkr: 80 })).toMatchObject({ amount: 80 });
  });
});

describe('toProjection', () => {
  it('maps an orders row to the customer-safe projection shape and drops hidden events', () => {
    const projection = toProjection({
      order_number: NUMBER, placed_at: '2026-10-19T10:00:00Z', customer_name: 'Ada', customer_email: 'ada@example.com', shipping_address: { city: 'Lahore' },
      subtotal_pkr: 1000, shipping_pkr: 250, tax_pkr: 0, tax_status: 'not_calculated', total_pkr: 1250, payment_method_label: 'Cash on delivery', payment_status: 'unpaid',
      fulfilment_status: 'shipped', shipping_method_label: 'Standard', tracking_carrier: 'TCS', tracking_number: '1', tracking_url: null, stock_state: 'committed', is_test: true,
      order_items: [{ product_slug: 'a', product_name: 'B', sku: 'S', quantity: 1, unit_price_pkr: 1000, line_total_pkr: 1000, created_at: '2026-10-19T10:00:00Z' }],
      order_events: [
        { kind: 'later', message: 'Two', visible_to_customer: true, created_at: '2026-10-20T10:00:00Z' },
        { kind: 'internal', message: 'Hidden', visible_to_customer: false, created_at: '2026-10-19T11:00:00Z' },
        { kind: 'order_placed', message: 'One', visible_to_customer: true, created_at: '2026-10-19T10:00:00Z' },
      ],
    });
    expect(projection).toMatchObject({ payment_method: 'Cash on delivery', shipping_method: 'Standard', email_hint: 'ada@example.com', total_pkr: 1250 });
    expect(projection.events.map((event) => event.message)).toEqual(['One', 'Two']);
    expect(projection).not.toHaveProperty('stock_state');
    expect(projection).not.toHaveProperty('is_test');
    expect(toProjection(null)).toBeNull();
  });
});

describe('validateAddress', () => {
  const good = { label: 'Home', recipient: 'Ada', phone: '0300 1234567', line1: '1 Road', line2: '', city: 'Lahore', province: 'Punjab', postal_code: '', is_default: false };
  it('accepts a complete address with an optional postal code', () => {
    expect(validateAddress(good)).toEqual({});
    expect(validateAddress({ ...good, postal_code: '54000' })).toEqual({});
  });
  it('mirrors the table limits', () => {
    const errors = validateAddress({ ...good, label: 'x'.repeat(41), recipient: '', phone: 'abc', line1: 'x'.repeat(201), city: '', province: '', postal_code: '12' });
    expect(Object.keys(errors).sort()).toEqual(['city', 'label', 'line1', 'phone', 'postal_code', 'province', 'recipient']);
  });
  it('addressPayload keeps only writable columns, trimmed', () => {
    const payload = addressPayload({ ...good, label: ' Home ', user_id: 'x', id: 'y', created_at: 'z' });
    expect(Object.keys(payload).sort()).toEqual(['city', 'is_default', 'label', 'line1', 'line2', 'phone', 'postal_code', 'province', 'recipient']);
    expect(payload.label).toBe('Home');
  });
});

describe('validateProfile and validateReturnRequest', () => {
  it('limits profile fields', () => {
    expect(validateProfile({ display_name: 'x'.repeat(81), phone: '12' })).toEqual({ display_name: expect.any(String), phone: expect.any(String) });
    expect(validateProfile({ display_name: '', phone: '' })).toEqual({});
  });
  it('requires name, order number, email and a message', () => {
    expect(validateReturnRequest({ name: 'Ada', order_number: NUMBER, message: 'Wrong size' }, null)).toEqual({});
    expect(Object.keys(validateReturnRequest({ name: '', order_number: 'x', message: ' ' }, 'Enter your email address.')).sort()).toEqual(['email', 'message', 'name', 'order_number']);
  });
});
