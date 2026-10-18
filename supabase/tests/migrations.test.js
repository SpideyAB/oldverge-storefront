import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestDatabase } from './support/db.js';

describe('migrations', () => {
  let db;
  beforeAll(async () => { db = await createTestDatabase(); });
  afterAll(async () => { await db.close(); });

  it('applies every migration to an empty database in order', () => {
    const files = inject('migrationFiles');
    expect(files.length).toBeGreaterThanOrEqual(7);
    expect([...files].sort()).toEqual(files);
  });

  it('creates the expected tables with row-level security on every public and private table', async () => {
    const { rows } = await db.main.query(`
      select n.nspname as schema, c.relname as name, c.relrowsecurity as rls
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname in ('public', 'private') order by 1, 2`);
    const names = rows.map((row) => `${row.schema}.${row.name}`);
    for (const expected of ['public.products', 'public.product_variants', 'public.orders', 'public.inventory', 'private.admin_members', 'private.order_access_tokens']) {
      expect(names).toContain(expected);
    }
    const withoutRls = rows.filter((row) => !row.rls).map((row) => `${row.schema}.${row.name}`);
    expect(withoutRls).toEqual([]);
  });

  it('seeds ordering as closed and cash on delivery as a disabled method', async () => {
    const setting = await db.main.query("select value from public.store_settings where key = 'ordering_enabled'");
    expect(setting.rows[0].value).toBe(false);
    const methods = await db.main.query('select code, enabled from public.payment_methods');
    expect(methods.rows).toEqual([{ code: 'cod', enabled: false }]);
  });
});
