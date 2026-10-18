// Input validation for Edge Function payloads. The database re-validates everything (it is the authority);
// this layer rejects malformed requests early, rejects unknown fields and keeps error messages generic.

export class ValidationError extends Error {
  constructor(field) {
    super(`invalid_field:${field}`);
    this.field = field;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Accepts national and international formats ("0300-1234567", "+92 300 1234567", "+44 20 7946 0958").
const PHONE = /^\+?[0-9][0-9 ()-]{3,28}[0-9]$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function rejectUnknown(object, allowed, where = 'body') {
  const extra = Object.keys(object).filter((key) => !allowed.includes(key));
  if (extra.length) throw new ValidationError(`${where}.${extra[0]}`);
}

export function text(value, field, { min = 0, max = 200 } = {}) {
  if (value === undefined || value === null) {
    if (min === 0) return '';
    throw new ValidationError(field);
  }
  if (typeof value !== 'string') throw new ValidationError(field);
  const clean = value.replace(CONTROL, '').trim();
  if (clean.length < min || clean.length > max) throw new ValidationError(field);
  return clean;
}

export function email(value, field = 'email') {
  const clean = text(value, field, { min: 3, max: 254 }).toLowerCase();
  if (!EMAIL.test(clean)) throw new ValidationError(field);
  return clean;
}

export function phone(value, field = 'phone', { optional = false } = {}) {
  const clean = text(value, field, { min: optional ? 0 : 5, max: 30 });
  if (clean === '' && optional) return '';
  if (!PHONE.test(clean)) throw new ValidationError(field);
  return clean;
}

export function uuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ValidationError(field);
  return value.toLowerCase();
}

export function code(value, field) {
  if (typeof value !== 'string' || !/^[a-z0-9_]{1,40}$/.test(value)) throw new ValidationError(field);
  return value;
}

export function integer(value, field, { min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) throw new ValidationError(field);
  return value;
}

export function lines(value, field = 'lines') {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new ValidationError(field);
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new ValidationError(`${field}[${index}]`);
    rejectUnknown(entry, ['variant_id', 'quantity'], `${field}[${index}]`);
    return { variant_id: uuid(entry.variant_id, `${field}[${index}].variant_id`), quantity: integer(entry.quantity, `${field}[${index}].quantity`, { min: 1, max: 99 }) };
  });
}

export function contact(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('contact');
  rejectUnknown(value, ['name', 'email', 'phone'], 'contact');
  return { name: text(value.name, 'contact.name', { min: 1, max: 120 }), email: email(value.email, 'contact.email'), phone: phone(value.phone, 'contact.phone') };
}

export function address(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('address');
  rejectUnknown(value, ['recipient', 'phone', 'line1', 'line2', 'city', 'province', 'postal_code', 'country'], 'address');
  const country = value.country === undefined ? 'PK' : value.country;
  if (country !== 'PK') throw new ValidationError('address.country');
  const out = {
    line1: text(value.line1, 'address.line1', { min: 1, max: 200 }),
    line2: text(value.line2, 'address.line2', { max: 200 }),
    city: text(value.city, 'address.city', { min: 1, max: 80 }),
    province: text(value.province, 'address.province', { min: 1, max: 80 }),
    postal_code: text(value.postal_code, 'address.postal_code', { max: 12 }),
    country: 'PK',
  };
  if (value.recipient !== undefined) out.recipient = text(value.recipient, 'address.recipient', { min: 1, max: 120 });
  if (value.phone !== undefined) out.phone = phone(value.phone, 'address.phone');
  return out;
}
