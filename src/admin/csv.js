// Safe CSV output for exports. RFC 4180 quoting, plus protection against spreadsheet formula injection: a text cell
// that a spreadsheet could read as a formula (starts with = + - @ tab or carriage return) is prefixed with a single quote.
// Real numbers are written as numbers (a negative number is not a formula).

const FORMULA_START = /^[=+\-@\t\r]/;
const FORMULA_AFTER_SPACE = /^\s+[=+\-@]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function escapeCell(value) {
  if (value === null || value === undefined) return '';
  let text;
  if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : '';
  else if (typeof value === 'bigint' || typeof value === 'boolean') text = String(value);
  else if (value instanceof Date) text = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  if (typeof value !== 'number' && (FORMULA_START.test(text) || FORMULA_AFTER_SPACE.test(text))) text = `'${text}`;
  if (NEEDS_QUOTES.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * columns: array of keys, or of { key, label }. rows: array of objects. Lines end with CRLF (RFC 4180).
 * Header labels are escaped the same way as data.
 */
export function toCsv(columns, rows) {
  const cols = columns.map((column) => (typeof column === 'string' ? { key: column, label: column } : { key: column.key, label: column.label ?? column.key }));
  const lines = [cols.map((column) => escapeCell(column.label)).join(',')];
  for (const row of rows) lines.push(cols.map((column) => escapeCell(row?.[column.key])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** Starts a browser download. A byte-order mark makes Excel read the file as UTF-8. */
export function downloadCsv(filename, csvText) {
  const blob = new Blob(['﻿', csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
