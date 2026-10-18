// Supabase reads and writes for the signed-in customer pages. Every function takes the client as its last
// argument (defaulting to the shared browser client) so tests can pass a fake.
//
// Column lists below are the COLUMN GRANTS from supabase/migrations/20261019000700_rls_grants_storage.sql.
// A customer can only select these columns of public.orders; `select *` is denied by Postgres. A test reads the
// migration and fails if these lists drift from the grants.

import { supabase } from '../../lib/supabase.js';
import { MAX_ADDRESSES, PAGE_SIZE, addressPayload } from './helpers.js';

export const ORDER_COLUMNS = [
  'id', 'user_id', 'order_number', 'placed_at', 'customer_name', 'customer_email', 'customer_phone', 'shipping_address', 'currency',
  'subtotal_pkr', 'shipping_pkr', 'tax_pkr', 'tax_status', 'total_pkr', 'payment_method_code', 'payment_method_label', 'payment_status',
  'fulfilment_status', 'shipping_method_code', 'shipping_method_label', 'tracking_carrier', 'tracking_number', 'tracking_url',
  'cancelled_at', 'cancel_reason', 'created_at', 'updated_at',
];
// Subset used by the list view (all granted).
export const ORDER_LIST_COLUMNS = ['id', 'order_number', 'placed_at', 'total_pkr', 'fulfilment_status', 'payment_status'];
// order_items: whole-table SELECT is granted; these are the columns the pages use.
export const ORDER_ITEM_COLUMNS = ['id', 'product_slug', 'sku', 'product_name', 'color', 'size', 'unit_price_pkr', 'quantity', 'line_total_pkr', 'image_path', 'created_at'];
export const ORDER_EVENT_COLUMNS = ['id', 'order_id', 'kind', 'from_state', 'to_state', 'message', 'visible_to_customer', 'created_at'];
// Columns a customer may write (INSERT and UPDATE grants). user_id is NOT writable: it defaults to auth.uid().
export const ADDRESS_WRITE_COLUMNS = ['label', 'recipient', 'phone', 'line1', 'line2', 'city', 'province', 'postal_code', 'is_default'];
export const ADDRESS_READ_COLUMNS = ['id', ...ADDRESS_WRITE_COLUMNS, 'created_at', 'updated_at'];
export const PROFILE_WRITE_COLUMNS = ['display_name', 'phone'];

const FAILED = { ok: false, error: 'failed', message: 'We could not load this right now. Please try again.' };

/** True for the answers PostgREST/Auth give when the access token is missing or no longer valid. */
export function isExpiredSession(error) {
  if (!error) return false;
  return Number(error.status) === 401 || error.code === 'PGRST301' || error.code === 'PGRST303' || /jwt (expired|invalid)|invalid jwt/i.test(String(error.message || ''));
}

/** Classifies a PostgREST error into { ok: false, error: 'expired' | 'network' | 'forbidden' | 'failed' | ..., message }. */
export function classifyError(error) {
  if (isExpiredSession(error)) return { ok: false, error: 'expired', message: 'Your session has expired. Please sign in again.' };
  const text = String(error?.message || '');
  if (/ov_error:too_many_addresses/.test(text)) return { ok: false, error: 'too_many_addresses', message: `You can save up to ${MAX_ADDRESSES} addresses. Remove one first.` };
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(text)) return { ok: false, error: 'network', message: 'We could not reach the server. Check your connection and try again.' };
  if (error?.code === '42501' || /permission denied/i.test(text)) return { ok: false, error: 'forbidden', message: 'This action is not allowed for your account.' };
  if (error?.code === '23505') return { ok: false, error: 'conflict', message: 'That change conflicts with another saved address. Reload and try again.' };
  return { ...FAILED };
}

const NOT_CONFIGURED = { ok: false, error: 'not_configured', message: 'Accounts are not available on this site yet.' };
const need = (client) => (client ? null : NOT_CONFIGURED);

const join = (columns) => columns.join(', ');
export const ORDER_LIST_SELECT = `${join(ORDER_LIST_COLUMNS)}, order_items(quantity)`;
export const ORDER_DETAIL_SELECT = `${join(ORDER_COLUMNS)}, order_items(${join(ORDER_ITEM_COLUMNS)}), order_events(${join(ORDER_EVENT_COLUMNS)})`;

/** One page of the signed-in customer's orders, newest first. Row-level security limits it to their own orders. */
export async function listMyOrders({ page = 1, pageSize = PAGE_SIZE } = {}, client = supabase) {
  const missing = need(client);
  if (missing) return missing;
  const safePage = Math.max(1, Math.floor(Number(page)) || 1);
  const from = (safePage - 1) * pageSize;
  try {
    const { data, error, count } = await client.from('orders').select(ORDER_LIST_SELECT, { count: 'exact' })
      .order('placed_at', { ascending: false }).range(from, from + pageSize - 1);
    if (error) return classifyError(error);
    const rows = (data || []).map((row) => ({ ...row, item_count: (row.order_items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) }));
    return { ok: true, data: { rows, total: typeof count === 'number' ? count : rows.length, page: safePage, pageSize } };
  } catch (error) {
    return classifyError(error);
  }
}

/** One order of the signed-in customer, found by its order number. data is null when there is no such order on this account. */
export async function getMyOrder(orderNumber, client = supabase) {
  const missing = need(client);
  if (missing) return missing;
  try {
    const { data, error } = await client.from('orders').select(ORDER_DETAIL_SELECT)
      .eq('order_number', String(orderNumber || '').trim().toUpperCase())
      .eq('order_events.visible_to_customer', true)
      .order('created_at', { referencedTable: 'order_items', ascending: true })
      .order('created_at', { referencedTable: 'order_events', ascending: true })
      .maybeSingle();
    if (error) return classifyError(error);
    return { ok: true, data: data || null };
  } catch (error) {
    return classifyError(error);
  }
}

export async function listAddresses(client = supabase) {
  const missing = need(client);
  if (missing) return missing;
  try {
    const { data, error } = await client.from('addresses').select(join(ADDRESS_READ_COLUMNS))
      .order('is_default', { ascending: false }).order('created_at', { ascending: true });
    if (error) return classifyError(error);
    return { ok: true, data: data || [] };
  } catch (error) {
    return classifyError(error);
  }
}

export async function countAddresses(client = supabase) {
  const missing = need(client);
  if (missing) return missing;
  try {
    const { count, error } = await client.from('addresses').select('id', { count: 'exact', head: true });
    if (error) return classifyError(error);
    return { ok: true, data: count || 0 };
  } catch (error) {
    return classifyError(error);
  }
}

/**
 * Creates (no id) or updates (id) an address. There is at most one default per customer (unique partial index), so a
 * new default first clears the old one. Those are two statements: if the second fails the old default stays cleared.
 */
export async function saveAddress({ id, values, existingCount = 0 }, client = supabase) {
  const missing = need(client);
  if (missing) return missing;
  const payload = addressPayload(values);
  if (!id && existingCount >= MAX_ADDRESSES) return classifyError({ message: 'ov_error:too_many_addresses' });
  try {
    if (payload.is_default) {
      let clear = client.from('addresses').update({ is_default: false }).eq('is_default', true);
      if (id) clear = clear.neq('id', id);
      const { error } = await clear;
      if (error) return classifyError(error);
    }
    const query = id
      ? client.from('addresses').update(payload).eq('id', id)
      : client.from('addresses').insert(payload);
    const { data, error } = await query.select(join(ADDRESS_READ_COLUMNS));
    if (error) return classifyError(error);
    if (id && !(data || []).length) return { ok: false, error: 'not_found', message: 'That address no longer exists. Reload the page.' };
    return { ok: true, data: data?.[0] || null };
  } catch (error) {
    return classifyError(error);
  }
}

export async function deleteAddress(id, client = supabase) {
  const missing = need(client);
  if (missing) return missing;
  try {
    const { error } = await client.from('addresses').delete().eq('id', id);
    if (error) return classifyError(error);
    return { ok: true };
  } catch (error) {
    return classifyError(error);
  }
}

export async function getProfile(userId, client = supabase) {
  const missing = need(client);
  if (missing) return missing;
  try {
    const { data, error } = await client.from('profiles').select(join(PROFILE_WRITE_COLUMNS)).eq('user_id', userId).maybeSingle();
    if (error) return classifyError(error);
    return { ok: true, data: data || { display_name: '', phone: '' } };
  } catch (error) {
    return classifyError(error);
  }
}

export async function saveProfile(userId, values, client = supabase) {
  const missing = need(client);
  if (missing) return missing;
  const payload = { display_name: String(values.display_name ?? '').trim(), phone: String(values.phone ?? '').trim() };
  try {
    const { data, error } = await client.from('profiles').update(payload).eq('user_id', userId).select(`user_id, ${join(PROFILE_WRITE_COLUMNS)}`);
    if (error) return classifyError(error);
    // Customers have no INSERT right on profiles; the row is created by a trigger at sign-up.
    if (!(data || []).length) return { ok: false, error: 'not_found', message: 'Your profile record was not found. Please contact the store.' };
    return { ok: true, data: data[0] };
  } catch (error) {
    return classifyError(error);
  }
}
