import { describe, expect, it } from 'vitest';
import {
  buildObjectName, canCancel, dayEndIso, dayStartIso, defaultRange, isValidImagePath, newOpKey, nextVersion, normalizeSections,
  paragraphsToText, parseCount, parseProvinces, parsePkr, planResize, refundCeiling, sanitizeBaseName, sectionsToStored, slugify,
  textToParagraphs, validateContactValue, validateHttpsUrl, validateRange, validateSections, validateSku, validateSlug, validateVariant,
} from './helpers.js';

describe('parsePkr', () => {
  it('accepts whole rupees', () => {
    expect(parsePkr('12500')).toEqual({ ok: true, value: 12500 });
    expect(parsePkr(0)).toEqual({ ok: true, value: 0 });
    expect(parsePkr(' 999 ')).toEqual({ ok: true, value: 999 });
  });
  it('rejects decimals, negatives, separators and junk', () => {
    for (const bad of ['12.5', '12,500', '-1', -1, 1.5, '', 'abc', '1e3', '1 000']) expect(parsePkr(bad).ok, String(bad)).toBe(false);
  });
  it('enforces a ceiling and a floor', () => {
    expect(parsePkr('100000001').ok).toBe(false);
    expect(parsePkr('0', { min: 1 }).ok).toBe(false);
    expect(parsePkr('50', { min: 1, max: 100 }).value).toBe(50);
  });
});

describe('parseCount', () => {
  it('parses counts and allows negatives only on request', () => {
    expect(parseCount('7').value).toBe(7);
    expect(parseCount('-3').ok).toBe(false);
    expect(parseCount('-3', { allowNegative: true, min: -10 }).value).toBe(-3);
    expect(parseCount('2.5').ok).toBe(false);
    expect(parseCount('1000001').ok).toBe(false);
  });
});

describe('sku, slug and variant validation', () => {
  it('matches the database patterns', () => {
    expect(validateSku('QZ-NAVY-M').ok).toBe(true);
    expect(validateSku('ab').ok).toBe(false);
    expect(validateSku('-abc').ok).toBe(false);
    expect(validateSku('has space').ok).toBe(false);
    expect(validateSlug('quarter-zip-navy').ok).toBe(true);
    expect(validateSlug('Quarter Zip').ok).toBe(false);
    expect(validateSlug('a--b').ok).toBe(false);
    expect(validateSlug('a'.repeat(81)).ok).toBe(false);
  });
  it('slugifies names', () => {
    expect(slugify('  Quarter-Zip: Navy / Édition! ')).toBe('quarter-zip-navy-edition');
    expect(slugify('***')).toBe('');
  });
  it('validates a variant form and normalises empties to null', () => {
    const good = validateVariant({ sku: 'QZ-001', price_pkr: '8900', color_name: 'Navy', color_hex: '#1A2B3C', size_label: '', sort_order: '', active: true });
    expect(good.ok).toBe(true);
    expect(good.value).toMatchObject({ sku: 'QZ-001', price_pkr: 8900, color_name: 'Navy', size_label: null, sort_order: 0, active: true });
    const bad = validateVariant({ sku: 'x', price_pkr: '-5.5', color_hex: 'navy' });
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.errors).sort()).toEqual(['color_hex', 'price_pkr', 'sku']);
  });
});

describe('image naming', () => {
  it('builds the versioned object name the upload function accepts', () => {
    const built = buildObjectName({ slug: 'quarter-zip-navy', version: 2, name: 'front-view' });
    expect(built).toEqual({ ok: true, path: 'products/quarter-zip-navy/v2/front-view.webp' });
    expect(isValidImagePath(built.path)).toBe(true);
  });
  it('refuses unsafe names and versions', () => {
    expect(buildObjectName({ slug: 'Bad Slug', version: 1, name: 'a' }).ok).toBe(false);
    expect(buildObjectName({ slug: 'ok', version: 0, name: 'a' }).ok).toBe(false);
    expect(buildObjectName({ slug: 'ok', version: 10000, name: 'a' }).ok).toBe(false);
    expect(buildObjectName({ slug: 'ok', version: 1, name: '../x' }).ok).toBe(false);
    expect(buildObjectName({ slug: 'ok', version: 1, name: 'a/b' }).ok).toBe(false);
    expect(buildObjectName({ slug: 'ok', version: 1, name: '' }).ok).toBe(false);
    expect(isValidImagePath('products/ok/../x.webp')).toBe(false);
    expect(isValidImagePath('/products/ok/v1/a.webp')).toBe(false);
  });
  it('turns file names into safe base names', () => {
    expect(sanitizeBaseName('IMG 0042 (Front).JPG')).toBe('img-0042-front');
    expect(sanitizeBaseName('....png')).toBe('image');
  });
  it('picks the next unused version', () => {
    expect(nextVersion([], 'a')).toBe(1);
    expect(nextVersion(['products/a/v1/x.webp', 'products/a/v3/y.webp', 'products/b/v9/z.webp'], 'a')).toBe(4);
    expect(nextVersion(['products/a/old.webp'], 'a')).toBe(1);
  });
});

describe('planResize', () => {
  it('limits the longest side to 2000 and keeps the ratio', () => {
    expect(planResize(4000, 3000)).toEqual({ ok: true, width: 2000, height: 1500, scaled: true });
    expect(planResize(3000, 6000)).toEqual({ ok: true, width: 1000, height: 2000, scaled: true });
  });
  it('never upscales', () => {
    expect(planResize(800, 600)).toEqual({ ok: true, width: 800, height: 600, scaled: false });
  });
  it('refuses unusable sizes', () => {
    expect(planResize(10, 500).ok).toBe(false);
    expect(planResize(0, 0).ok).toBe(false);
    expect(planResize(NaN, 10).ok).toBe(false);
    expect(planResize(30000, 4000).ok).toBe(false);
    expect(planResize(8000, 20).ok).toBe(false);
  });
});

describe('links and contact settings', () => {
  it('accepts only https links', () => {
    expect(validateHttpsUrl('https://example.com/a').ok).toBe(true);
    expect(validateHttpsUrl('http://example.com').ok).toBe(false);
    expect(validateHttpsUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateHttpsUrl('').value).toBeNull();
    expect(validateHttpsUrl('', { required: true }).ok).toBe(false);
    expect(validateHttpsUrl('https://a b.com').ok).toBe(false);
  });
  it('validates public contact values; cleared values are the empty string', () => {
    expect(validateContactValue('contact.email', 'hello@oldverge.pk').ok).toBe(true);
    expect(validateContactValue('contact.email', 'nope').ok).toBe(false);
    expect(validateContactValue('contact.phone', '+92 300 1234567').ok).toBe(true);
    expect(validateContactValue('contact.phone', 'call me').ok).toBe(false);
    expect(validateContactValue('contact.instagram', '@oldverge').ok).toBe(true);
    expect(validateContactValue('contact.instagram', 'javascript:x').ok).toBe(false);
    expect(validateContactValue('contact.address', '')).toEqual({ ok: true, value: '' });
  });
});

describe('dates', () => {
  it('builds a default range ending today', () => {
    const range = defaultRange(30, new Date(2026, 9, 18));
    expect(range).toEqual({ from: '2026-09-19', to: '2026-10-18' });
  });
  it('converts local days to inclusive ISO bounds', () => {
    const start = new Date(dayStartIso('2026-10-18'));
    const end = new Date(dayEndIso('2026-10-18'));
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 9, 18, 0]);
    expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([18, 23, 59]);
    expect(dayStartIso('2026-02-31')).toBeNull();
    expect(dayStartIso('18/10/2026')).toBeNull();
  });
  it('validates ranges', () => {
    expect(validateRange('2026-10-01', '2026-10-18').ok).toBe(true);
    expect(validateRange('2026-10-19', '2026-10-18').ok).toBe(false);
    expect(validateRange('', '2026-10-18').ok).toBe(false);
  });
});

describe('orders and refunds', () => {
  it('only allows cancelling before dispatch', () => {
    expect(canCancel({ fulfilment_status: 'unfulfilled' })).toBe(true);
    expect(canCancel({ fulfilment_status: 'shipped' })).toBe(false);
    expect(canCancel({ fulfilment_status: 'cancelled' })).toBe(false);
  });
  it('limits a refund to what is left of the total', () => {
    const order = { total_pkr: 10000 };
    const refunds = [{ status: 'confirmed', amount_pkr: 3000 }, { status: 'requested', amount_pkr: 2000 }, { status: 'cancelled', amount_pkr: 5000 }, { status: 'failed', amount_pkr: 1 }];
    expect(refundCeiling(order, refunds)).toBe(5000);
    expect(refundCeiling(order, [])).toBe(10000);
    expect(refundCeiling({ total_pkr: 100 }, [{ status: 'confirmed', amount_pkr: 500 }])).toBe(0);
  });
});

describe('policy sections', () => {
  it('splits and joins paragraphs on blank lines', () => {
    expect(textToParagraphs('One.\n\n  Two.  \n\n\nThree.')).toEqual(['One.', 'Two.', 'Three.']);
    expect(paragraphsToText(['a', 'b'])).toBe('a\n\nb');
  });
  it('normalises stored data defensively', () => {
    expect(normalizeSections(null)).toEqual([]);
    expect(normalizeSections([{ heading: 'H', body: ['x', 3] }, 5])).toEqual([{ heading: 'H', body: ['x'] }, { heading: '', body: [] }]);
  });
  it('converts editable sections back and validates them', () => {
    const stored = sectionsToStored([{ heading: ' Delivery ', text: 'A\n\nB' }, { heading: '', text: '' }]);
    expect(stored).toEqual([{ heading: 'Delivery', body: ['A', 'B'] }]);
    expect(validateSections(stored).ok).toBe(true);
    expect(validateSections([]).ok).toBe(false);
    expect(validateSections([{ heading: '', body: ['x'] }]).ok).toBe(false);
    expect(validateSections([{ heading: 'H', body: [] }]).ok).toBe(false);
  });
});

describe('misc', () => {
  it('parses province lists', () => {
    expect(parseProvinces('Sindh, Punjab, Sindh')).toEqual(['Sindh', 'Punjab']);
    expect(parseProvinces(' ')).toBeNull();
  });
  it('generates distinct operation keys', () => {
    const a = newOpKey(); const b = newOpKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
  });
});
