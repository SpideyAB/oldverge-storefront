import { describe, expect, it } from 'vitest';
import { AdminError, describeError, describeProblems, readError } from './errors.js';

describe('readError', () => {
  it('reads the ov_error code and JSON detail from a database error', () => {
    const info = readError({ message: 'ov_error:not_ready_to_sell', details: '["price_missing"]', code: 'P0001' });
    expect(info).toMatchObject({ code: 'not_ready_to_sell', details: ['price_missing'], sqlstate: 'P0001' });
  });

  it('reads an Edge Function answer', () => {
    expect(readError({ status: 409, error: 'already_public' })).toMatchObject({ code: 'already_public', status: 409 });
  });

  it('survives junk', () => {
    expect(readError(null).code).toBeNull();
    expect(readError({ message: 'x', details: '{broken' }).details).toBeNull();
  });
});

describe('describeError', () => {
  it('explains the main ov_error codes in a short sentence', () => {
    for (const code of ['forbidden', 'owner_only', 'invalid_transition', 'payment_not_settled', 'not_ready_to_sell', 'not_publishable', 'provenance_required', 'below_reserved', 'refund_exceeds_total', 'product_has_orders', 'only_drafts_can_be_deleted', 'policy_draft_empty', 'nothing_to_refund']) {
      const text = describeError({ message: `ov_error:${code}`, code: 'P0001' });
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain('ov_error');
      expect(text).not.toContain(code);
    }
  });

  it('lists the exact missing items for readiness failures', () => {
    const text = describeError({ message: 'ov_error:not_ready_to_sell', details: '["no_approved_cover_image","stock_not_verified"]' });
    expect(text).toContain('no approved cover image');
    expect(text).toContain('stock has not been counted');
  });

  it('includes the reserved count for below_reserved', () => {
    expect(describeError({ message: 'ov_error:below_reserved', details: '{"reserved":3}' })).toContain('3');
  });

  it('maps common SQLSTATE failures without leaking database text', () => {
    const text = describeError({ code: '23505', message: 'duplicate key value violates unique constraint "product_variants_sku_key"' });
    expect(text).toMatch(/already used/);
    expect(text).not.toMatch(/product_variants_sku_key/);
  });

  it('is honest about unknown failures', () => {
    expect(describeError({ message: 'weird' })).toMatch(/did not complete/);
    expect(describeError({ error: 'brand_new_code' })).toContain('brand_new_code');
  });

  it('reports network failure and expired sessions', () => {
    expect(describeError({ status: 0, error: 'network_error' })).toMatch(/Could not reach/);
    expect(describeError({ message: 'JWT expired', code: 'PGRST301' })).toMatch(/Sign in again/);
  });
});

describe('AdminError', () => {
  it('flags forbidden so the app returns to access denied', () => {
    const error = new AdminError({ message: 'ov_error:forbidden', code: '42501' });
    expect(error.forbidden).toBe(true);
    expect(error.recheck).toBe(false);
  });

  it('does not treat owner_only as a loss of access', () => {
    const error = new AdminError({ message: 'ov_error:owner_only', code: '42501' });
    expect(error.forbidden).toBe(false);
    expect(error.recheck).toBe(false);
    expect(error.message).toMatch(/owner/);
  });

  it('asks for a re-check on a row-level-security failure or a 401', () => {
    expect(new AdminError({ code: '42501', message: 'new row violates row-level security policy' }).recheck).toBe(true);
    expect(new AdminError({ status: 401, error: 'invalid_session' }).recheck).toBe(true);
  });

  it('keeps ordinary failures local', () => {
    const error = new AdminError({ message: 'ov_error:invalid_transition', details: '{"from":"shipped","to":"processing"}' });
    expect(error.forbidden).toBe(false);
    expect(error.recheck).toBe(false);
    expect(error.message).toContain('shipped');
  });
});

describe('describeProblems', () => {
  it('translates known codes and tolerates unknown ones', () => {
    expect(describeProblems(['no_contact_channel', 'something_new'])).toEqual([
      'no public contact email, phone or WhatsApp number is set',
      'something new',
    ]);
    expect(describeProblems(null)).toEqual([]);
  });
});
