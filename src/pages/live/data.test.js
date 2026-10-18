import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase.js', () => ({ supabase: null }));

const {
  ADDRESS_READ_COLUMNS, ADDRESS_WRITE_COLUMNS, ORDER_COLUMNS, ORDER_DETAIL_SELECT, ORDER_EVENT_COLUMNS, ORDER_ITEM_COLUMNS, ORDER_LIST_COLUMNS,
  ORDER_LIST_SELECT, PROFILE_WRITE_COLUMNS, classifyError, deleteAddress, getMyOrder, getProfile, isExpiredSession, listMyOrders, saveAddress, saveProfile,
} = await import('./data.js');

// ---------------------------------------------------------------- contract with the SQL grants
const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const grantsSql = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort().map((name) => readFileSync(join(migrationsDir, name), 'utf8')).join('\n');
const columnsOf = (pattern) => {
  const match = pattern.exec(grantsSql);
  if (!match) throw new Error(`grant not found: ${pattern}`);
  return match[1].split(',').map((column) => column.trim()).filter(Boolean);
};

describe('column lists match the database grants', () => {
  it('orders: exactly the granted SELECT columns', () => {
    const granted = columnsOf(/grant select \(([^)]*)\)\s+on public\.orders to authenticated/);
    expect([...ORDER_COLUMNS].sort()).toEqual([...granted].sort());
  });

  it('orders: never asks for a column customers cannot read', () => {
    for (const forbidden of ['stock_state', 'needs_attention', 'attention_reason', 'is_test']) {
      expect(ORDER_COLUMNS).not.toContain(forbidden);
      expect(ORDER_DETAIL_SELECT).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
    expect(ORDER_DETAIL_SELECT).not.toContain('*');
    expect(ORDER_LIST_SELECT).not.toContain('*');
    for (const column of ORDER_LIST_COLUMNS) expect(ORDER_COLUMNS).toContain(column);
  });

  it('order_events: exactly the granted SELECT columns', () => {
    const granted = columnsOf(/grant select \(([^)]*)\) on public\.order_events to authenticated/);
    expect([...ORDER_EVENT_COLUMNS].sort()).toEqual([...granted].sort());
  });

  it('order_items: only real columns of the table', () => {
    const table = /create table public\.order_items \(([\s\S]*?)\n\);/.exec(grantsSql)[1];
    for (const column of ORDER_ITEM_COLUMNS) expect(table).toMatch(new RegExp(`^\\s+${column} `, 'm'));
  });

  it('addresses: the writable columns equal the INSERT and UPDATE grants, and user_id is not among them', () => {
    const insert = columnsOf(/grant insert \(([^)]*)\) on public\.addresses to authenticated/);
    const update = columnsOf(/grant update \(([^)]*)\) on public\.addresses to authenticated/);
    expect([...ADDRESS_WRITE_COLUMNS].sort()).toEqual([...insert].sort());
    expect([...ADDRESS_WRITE_COLUMNS].sort()).toEqual([...update].sort());
    expect(ADDRESS_WRITE_COLUMNS).not.toContain('user_id');
    expect(ADDRESS_READ_COLUMNS).toEqual(expect.arrayContaining(ADDRESS_WRITE_COLUMNS));
  });

  it('profiles: the writable columns equal the UPDATE grant', () => {
    const update = columnsOf(/grant update \(([^)]*)\) on public\.profiles to authenticated/);
    expect([...PROFILE_WRITE_COLUMNS].sort()).toEqual([...update].sort());
  });
});

// ---------------------------------------------------------------- query shapes
/** A chainable, awaitable stand-in for a PostgREST query builder. Records every call. */
function fakeClient(result) {
  const log = [];
  const builder = new Proxy(() => {}, {
    get(_target, property) {
      if (property === 'then') return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      return (...args) => { log.push([property, ...args]); return builder; };
    },
  });
  return { log, from: (table) => { log.push(['from', table]); return builder; } };
}
const calls = (client, name) => client.log.filter(([method]) => method === name).map(([, ...args]) => args);

describe('listMyOrders', () => {
  it('pages ten at a time, newest first, with an exact count', async () => {
    const client = fakeClient({ data: [{ id: 'o1', order_number: 'OV-261019-1A2B3C4D', order_items: [{ quantity: 2 }, { quantity: 1 }] }], count: 23, error: null });
    const result = await listMyOrders({ page: 3 }, client);
    expect(calls(client, 'from')).toEqual([['orders']]);
    expect(calls(client, 'range')).toEqual([[20, 29]]);
    expect(calls(client, 'order')).toEqual([['placed_at', { ascending: false }]]);
    expect(calls(client, 'select')[0][1]).toEqual({ count: 'exact' });
    expect(result).toMatchObject({ ok: true, data: { total: 23, page: 3, pageSize: 10 } });
    expect(result.data.rows[0].item_count).toBe(3);
  });

  it('clamps nonsense page numbers to 1', async () => {
    const client = fakeClient({ data: [], count: 0, error: null });
    await listMyOrders({ page: -4 }, client);
    expect(calls(client, 'range')).toEqual([[0, 9]]);
  });

  it('reports an expired session', async () => {
    const client = fakeClient({ data: null, error: { code: 'PGRST301', message: 'JWT expired', status: 401 } });
    expect(await listMyOrders({}, client)).toMatchObject({ ok: false, error: 'expired' });
  });

  it('answers not_configured without a client', async () => {
    expect(await listMyOrders({}, null)).toMatchObject({ ok: false, error: 'not_configured' });
  });
});

describe('getMyOrder', () => {
  it('looks the order up by its number and only keeps customer-visible events', async () => {
    const client = fakeClient({ data: { order_number: 'OV-261019-1A2B3C4D' }, error: null });
    const result = await getMyOrder(' ov-261019-1a2b3c4d ', client);
    expect(calls(client, 'select')[0][0]).toBe(ORDER_DETAIL_SELECT);
    expect(calls(client, 'eq')).toEqual([['order_number', 'OV-261019-1A2B3C4D'], ['order_events.visible_to_customer', true]]);
    expect(result).toEqual({ ok: true, data: { order_number: 'OV-261019-1A2B3C4D' } });
  });

  it('returns data: null when no order matches', async () => {
    expect(await getMyOrder('OV-261019-00000000', fakeClient({ data: null, error: null }))).toEqual({ ok: true, data: null });
  });
});

describe('addresses', () => {
  const values = { label: ' Home ', recipient: 'Ada', phone: '0300 1234567', line1: '1 Road', line2: '', city: 'Lahore', province: 'Punjab', postal_code: '54000', is_default: true, user_id: 'attacker', id: 'x' };

  it('inserts only the granted columns (never user_id) and clears the old default first', async () => {
    const client = fakeClient({ data: [{ id: 'a1' }], error: null });
    const result = await saveAddress({ values, existingCount: 2 }, client);
    expect(result.ok).toBe(true);
    const [payload] = calls(client, 'insert')[0];
    expect(Object.keys(payload).sort()).toEqual([...ADDRESS_WRITE_COLUMNS].sort());
    expect(payload.label).toBe('Home');
    expect(calls(client, 'update')[0][0]).toEqual({ is_default: false });
    expect(client.log.findIndex(([m]) => m === 'update')).toBeLessThan(client.log.findIndex(([m]) => m === 'insert'));
  });

  it('updates by id and reports a vanished row', async () => {
    const client = fakeClient({ data: [], error: null });
    const result = await saveAddress({ id: 'a1', values: { ...values, is_default: false }, existingCount: 3 }, client);
    expect(calls(client, 'update')).toHaveLength(1);
    expect(result).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('refuses an eleventh address before calling the server', async () => {
    const client = fakeClient({ data: [], error: null });
    expect(await saveAddress({ values, existingCount: 10 }, client)).toMatchObject({ ok: false, error: 'too_many_addresses' });
    expect(client.log).toEqual([]);
  });

  it('maps the database trigger error', () => {
    expect(classifyError({ message: 'ov_error:too_many_addresses' })).toMatchObject({ error: 'too_many_addresses' });
  });

  it('deletes by id', async () => {
    const client = fakeClient({ error: null });
    expect(await deleteAddress('a1', client)).toEqual({ ok: true });
    expect(calls(client, 'delete')).toEqual([[]]);
    expect(calls(client, 'eq')).toEqual([['id', 'a1']]);
  });
});

describe('profile', () => {
  it('reads and writes only display_name and phone', async () => {
    const read = fakeClient({ data: { display_name: 'Ada', phone: '' }, error: null });
    expect(await getProfile('u1', read)).toMatchObject({ ok: true, data: { display_name: 'Ada' } });
    expect(calls(read, 'select')[0][0]).toBe('display_name, phone');
    const write = fakeClient({ data: [{ user_id: 'u1', display_name: 'Ada', phone: '' }], error: null });
    await saveProfile('u1', { display_name: ' Ada ', phone: '', user_id: 'other' }, write);
    expect(calls(write, 'update')).toEqual([[{ display_name: 'Ada', phone: '' }]]);
  });

  it('says so when there is no profile row to update', async () => {
    expect(await saveProfile('u1', { display_name: 'A', phone: '' }, fakeClient({ data: [], error: null }))).toMatchObject({ ok: false, error: 'not_found' });
  });
});

describe('error classification', () => {
  it('recognises expired sessions, network failures and permission errors', () => {
    expect(isExpiredSession({ status: 401 })).toBe(true);
    expect(isExpiredSession({ message: 'JWT expired' })).toBe(true);
    expect(isExpiredSession({ message: 'duplicate key' })).toBe(false);
    expect(classifyError({ message: 'TypeError: Failed to fetch' }).error).toBe('network');
    expect(classifyError({ code: '42501', message: 'permission denied for table orders' }).error).toBe('forbidden');
    expect(classifyError({ message: 'boom with secrets' }).message).not.toContain('secrets');
  });
});
