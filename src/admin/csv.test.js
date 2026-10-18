import { describe, expect, it } from 'vitest';
import { escapeCell, toCsv } from './csv.js';

describe('escapeCell', () => {
  it('leaves plain text alone and writes empty for null/undefined', () => {
    expect(escapeCell('Ali Khan')).toBe('Ali Khan');
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(undefined)).toBe('');
  });

  it('quotes commas, quotes and line breaks (RFC 4180) and doubles inner quotes', () => {
    expect(escapeCell('a,b')).toBe('"a,b"');
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('prefixes a single quote to cells a spreadsheet could read as a formula', () => {
    expect(escapeCell('=1+1')).toBe("'=1+1");
    expect(escapeCell('+92300')).toBe("'+92300");
    expect(escapeCell('-2+3')).toBe("'-2+3");
    expect(escapeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCell('\tcmd')).toBe("'\tcmd");
    expect(escapeCell('\rcmd')).toBe('"\'\rcmd"');
    expect(escapeCell('  =HYPERLINK("x")')).toBe('"\'  =HYPERLINK(""x"")"');
  });

  it('protects first, then quotes when the protected text needs quoting', () => {
    expect(escapeCell('=A1,B1')).toBe('"\'=A1,B1"');
  });

  it('does not alter real numbers, including negatives', () => {
    expect(escapeCell(-5)).toBe('-5');
    expect(escapeCell(12500)).toBe('12500');
    expect(escapeCell(Number.NaN)).toBe('');
  });

  it('writes booleans, dates and objects predictably', () => {
    expect(escapeCell(true)).toBe('true');
    expect(escapeCell(new Date('2026-10-18T10:00:00Z'))).toBe('2026-10-18T10:00:00.000Z');
    expect(escapeCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('toCsv', () => {
  it('writes a header and CRLF lines', () => {
    const text = toCsv([{ key: 'n', label: 'Order' }, 'total'], [{ n: 'OV-1', total: 100 }, { n: '=bad', total: -1 }]);
    expect(text).toBe("Order,total\r\nOV-1,100\r\n'=bad,-1\r\n");
  });

  it('writes only a header for no rows and tolerates missing keys', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n');
    expect(toCsv(['a', 'b'], [{ a: 1 }])).toBe('a,b\r\n1,\r\n');
  });

  it('protects header labels too', () => {
    expect(toCsv([{ key: 'x', label: '=evil' }], [])).toBe("'=evil\r\n");
  });
});
