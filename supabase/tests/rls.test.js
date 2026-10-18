import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asService, asUser, createTestDatabase, expectDenied, newUuid, sha256 } from './support/db.js';
import { checkoutPayload, openOrdering, placeOrder, seedStore } from './support/fixtures.js';

describe('row-level security and grants: access matrix', () => {
  let db; let ids; let orderA; let orderGuest;
  beforeAll(async () => {
    db = await createTestDatabase();
    ids = await seedStore(db);
    await openOrdering(db);
    const lines = [{ variant_id: ids.zipM, quantity: 1 }];
    orderA = await placeOrder(db.main, { lines, expectedTotal: 8740, userId: ids.customerA });
    orderGuest = await placeOrder(db.main, { lines, expectedTotal: 8740 });
    await db.main.query("insert into public.addresses (user_id, recipient, phone, line1, city, province) values ($1, 'A', '03001234567', 'x', 'Lahore', 'Punjab'), ($2, 'B', '03007654321', 'y', 'Lahore', 'Punjab')", [ids.customerA, ids.customerB]);
    await db.main.query("insert into public.contact_messages (first_name, email, message) values ('X', 'x@example.test', 'hello')");
    await db.main.query("insert into public.newsletter_subscriptions (email, consent_text, unsubscribe_token_hash) values ('n@example.test', 'consent', $1)", [sha256('t')]);
  });
  afterAll(async () => { await db.close(); });

  const count = async (client, table) => (await client.query(`select count(*)::int as n from ${table}`)).rows[0].n;

  describe('anonymous visitors', () => {
    it('read only published catalogue, public settings, approved public images and published policies', async () => {
      await db.main.query("insert into public.products (slug, name, category_id, kind) values ('draft-only', 'Draft Only', $1, 'watch')", [ids.catWatches]);
      const slugs = (await asAnon(db.main, (c) => c.query('select slug from public.products order by slug'))).rows.map((row) => row.slug);
      expect(slugs).toEqual(['casio-test', 'zip-test-black']);
      const settings = (await asAnon(db.main, (c) => c.query('select key from public.store_settings'))).rows.map((row) => row.key);
      expect(settings).toContain('ordering_enabled');
      expect(settings).not.toContain('reservation_minutes');
      await db.main.query("insert into public.product_images (product_id, bucket, path, approval_status) values ($1, 'product-private', 'draft/x.webp', 'unverified')", [ids.zipProduct]);
      const images = (await asAnon(db.main, (c) => c.query('select bucket, approval_status from public.product_images'))).rows;
      expect(images.every((row) => row.bucket === 'product-public' && row.approval_status === 'approved')).toBe(true);
      const policies = (await asAnon(db.main, (c) => c.query('select slug, published_sections from public.policy_pages'))).rows;
      expect(policies).toHaveLength(4);
    });

    it('cannot read or write orders, inventory, messages, drafts, outbox, audit log or private tables', async () => {
      for (const table of ['public.orders', 'public.order_items', 'public.order_events', 'public.inventory', 'public.inventory_movements', 'public.stock_reservations',
        'public.payment_attempts', 'public.refunds', 'public.contact_messages', 'public.newsletter_subscriptions', 'public.notification_outbox',
        'public.admin_audit_log', 'public.policy_drafts', 'public.order_notes', 'public.profiles', 'public.addresses',
        'private.admin_members', 'private.order_access_tokens', 'private.checkout_requests', 'private.settings']) {
        await expectDenied(asAnon(db.main, (c) => c.query(`select * from ${table}`)));
      }
      await expectDenied(asAnon(db.main, (c) => c.query("insert into public.orders (order_number) values ('x')")));
      await expectDenied(asAnon(db.main, (c) => c.query("update public.products set name = 'hacked'")));
      await expectDenied(asAnon(db.main, (c) => c.query("insert into public.contact_messages (first_name, email, message) values ('a', 'b@c.de', 'spam')")));
    });

    it('cannot call admin or server-only functions', async () => {
      await expectDenied(asAnon(db.main, (c) => c.query('select public.admin_dashboard_stats()')));
      await expectDenied(asAnon(db.main, (c) => c.query('select public.admin_list_orders()')));
      await expectDenied(asAnon(db.main, (c) => c.query("select public.get_order_for_access('OV-1', $1)", [sha256('x')])));
      await expectDenied(asAnon(db.main, (c) => c.query('select public.run_maintenance()')));
      await expectDenied(asAnon(db.main, (c) => c.query("select public.hit_rate_limit('k', 1, 60)")));
      await expectDenied(asAnon(db.main, (c) => c.query("select public.submit_contact('{}'::jsonb)")));
    });
  });

  describe('signed-in customers', () => {
    it("see only their own orders, items and visible events; never another customer's or a guest's", async () => {
      const a = (await asUser(db.main, ids.customerA, (c) => c.query('select order_number from public.orders'))).rows;
      expect(a.map((row) => row.order_number)).toEqual([orderA.order_number]);
      expect((await asUser(db.main, ids.customerB, (c) => c.query('select order_number from public.orders'))).rows).toEqual([]);
      expect((await asUser(db.main, ids.customerB, (c) => c.query('select * from public.order_items'))).rows).toEqual([]);
      expect(await asUser(db.main, ids.customerA, (c) => count(c, 'public.order_items'))).toBe(1);
      expect(await asUser(db.main, ids.customerA, (c) => count(c, 'public.order_events'))).toBe(1);
    });

    it('cannot read internal order columns or write financial, status or inventory data directly', async () => {
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query('select needs_attention from public.orders')));
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query('select stock_state, is_test from public.orders')));
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query('select attention_reason from public.orders')));
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query("update public.orders set total_pkr = 1, payment_status = 'paid'")));
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query("update public.order_items set unit_price_pkr = 1")));
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query('delete from public.orders')));
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query('update public.inventory set on_hand = 999')));
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query("insert into public.inventory_movements (variant_id, kind) values ($1, 'adjustment')", [ids.zipM])));
      // Row-level security filters these silently: zero rows are affected and nothing changes.
      expect((await asUser(db.main, ids.customerA, (c) => c.query("update public.products set status = 'archived'"))).rowCount).toBe(0);
      expect((await asUser(db.main, ids.customerA, (c) => c.query("update public.store_settings set value = 'true'::jsonb where key = 'ordering_enabled'"))).rowCount).toBe(0);
      expect((await db.main.query("select count(*)::int as n from public.products where status = 'archived'")).rows[0].n).toBe(0);
    });

    it("cannot read or change another customer's profile or addresses", async () => {
      const own = (await asUser(db.main, ids.customerA, (c) => c.query('select recipient from public.addresses'))).rows;
      expect(own).toEqual([{ recipient: 'A' }]);
      const upd = await asUser(db.main, ids.customerA, (c) => c.query("update public.addresses set line1 = 'hijack' where recipient = 'B'"));
      expect(upd.rowCount).toBe(0);
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query("insert into public.addresses (user_id, recipient, phone, line1, city, province) values ($1, 'x', '03001234567', 'y', 'z', 'p')", [ids.customerB])));
      const profiles = (await asUser(db.main, ids.customerA, (c) => c.query('select user_id from public.profiles'))).rows;
      expect(profiles).toEqual([{ user_id: ids.customerA }]);
      const upd2 = await asUser(db.main, ids.customerA, (c) => c.query("update public.profiles set display_name = 'hacked' where user_id = $1", [ids.customerB]));
      expect(upd2.rowCount).toBe(0);
    });

    it('cannot grant themselves admin through profile fields, signup metadata or JWT claims', async () => {
      const fresh = newUuid();
      await db.main.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'evil@example.test', $2)", [fresh, JSON.stringify({ full_name: 'Evil', role: 'owner', is_admin: true, admin: true })]);
      const profile = (await db.main.query('select display_name from public.profiles where user_id = $1', [fresh])).rows[0];
      expect(profile.display_name).toBe('Evil');
      const admin = (await asUser(db.main, fresh, (c) => c.query('select public.is_admin() as a', []), { app_metadata: { role: 'owner' }, user_metadata: { role: 'owner', admin: true } })).rows[0].a;
      expect(admin).toBe(false);
      await expectDenied(asUser(db.main, fresh, (c) => c.query("update public.profiles set role = 'owner' where user_id = $1", [fresh])));
      await expectDenied(asUser(db.main, fresh, (c) => c.query('select public.admin_dashboard_stats()')));
      await expectDenied(asUser(db.main, fresh, (c) => c.query("insert into private.admin_members (user_id, role) values ($1, 'owner')", [fresh])));
      await expectDenied(asUser(db.main, fresh, (c) => c.query('select public.admin_set_ordering_enabled(true)')));
    });

    it('limit addresses to ten per account', async () => {
      const u = newUuid();
      await db.main.query("insert into auth.users (id, email) values ($1, 'many@example.test')", [u]);
      for (let i = 0; i < 10; i += 1) {
        await asUser(db.main, u, (c) => c.query("insert into public.addresses (recipient, phone, line1, city, province) values ('r', '03001234567', 'l', 'c', 'p')"));
      }
      await expect(asUser(db.main, u, (c) => c.query("insert into public.addresses (recipient, phone, line1, city, province) values ('r', '03001234567', 'l', 'c', 'p')"))).rejects.toThrow(/too_many_addresses/);
    });
  });

  describe('admins', () => {
    it('are recognised only from current protected membership', async () => {
      expect((await asUser(db.main, ids.owner, (c) => c.query('select public.is_admin() as a, public.admin_role() as r'))).rows[0]).toEqual({ a: true, r: 'owner' });
      expect((await asUser(db.main, ids.staff, (c) => c.query('select public.admin_role() as r'))).rows[0].r).toBe('staff');
      expect((await asUser(db.main, ids.customerA, (c) => c.query('select public.is_admin() as a'))).rows[0].a).toBe(false);
      await db.main.query('delete from private.admin_members where user_id = $1', [ids.staff]);
      await expectDenied(asUser(db.main, ids.staff, (c) => c.query('select public.admin_dashboard_stats()')));   // revoked immediately
      await db.main.query("insert into private.admin_members (user_id, role) values ($1, 'staff')", [ids.staff]);
    });

    it('can read operational tables but still cannot write orders, inventory or the audit log directly', async () => {
      expect(await asUser(db.main, ids.owner, (c) => count(c, 'public.inventory'))).toBeGreaterThan(0);
      expect(await asUser(db.main, ids.owner, (c) => count(c, 'public.contact_messages'))).toBe(1);
      await expectDenied(asUser(db.main, ids.owner, (c) => c.query('update public.inventory set on_hand = 999')));
      await expectDenied(asUser(db.main, ids.owner, (c) => c.query("update public.orders set total_pkr = 1")));
      await expectDenied(asUser(db.main, ids.owner, (c) => c.query("insert into public.admin_audit_log (action, entity) values ('x', 'y')")));
      await expectDenied(asUser(db.main, ids.owner, (c) => c.query('delete from public.admin_audit_log')));
      await expectDenied(asUser(db.main, ids.owner, (c) => c.query('select * from private.admin_members')));
      await expect(asUser(db.main, ids.owner, (c) => c.query("update public.store_settings set value = 'false'::jsonb where key = 'ordering_enabled'"))).rejects.toThrow(/use_admin_set_ordering_enabled/);   // must use the guarded function
    });

    it('can edit catalogue rows and every change lands in the audit log', async () => {
      await asUser(db.main, ids.staff, (c) => c.query("update public.products set description = 'Audited edit' where id = $1", [ids.zipProduct]));
      const log = (await db.main.query("select actor_id, action, entity from public.admin_audit_log where entity = 'public.products' and after_data ->> 'description' = 'Audited edit'")).rows;
      expect(log).toEqual([{ actor_id: ids.staff, action: 'update', entity: 'public.products' }]);
    });

    it('cannot read newsletter token hashes or draft policy text as anyone but an admin', async () => {
      await expectDenied(asUser(db.main, ids.owner, (c) => c.query('select unsubscribe_token_hash from public.newsletter_subscriptions')));
      expect(await asUser(db.main, ids.owner, (c) => count(c, 'public.policy_drafts'))).toBe(4);
      expect((await asUser(db.main, ids.customerA, (c) => c.query('select * from public.policy_drafts'))).rows).toEqual([]);
      expect((await asAnon(db.main, (c) => c.query('select 1 from public.policy_pages where published_at is not null'))).rowCount).toBe(4);
    });
  });

  describe('function EXECUTE grants', () => {
    it('allow anonymous callers only the intended public helpers', async () => {
      const { rows } = await db.main.query(`
        select n.nspname || '.' || p.proname as sig
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private') and p.prokind = 'f'
           and has_function_privilege('anon', p.oid, 'execute')
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
      expect(rows.map((row) => row.sig).sort()).toEqual([
        'public.admin_role', 'public.catalog_availability', 'public.is_admin', 'public.search_catalog',
      ]);
    });

    it('allow no customer-callable function outside the admin and public sets, and server functions only to service_role', async () => {
      const { rows } = await db.main.query(`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')`);
      const names = rows.map((row) => row.proname);
      for (const serverOnly of ['create_order', 'quote_order', 'get_order_for_access', 'apply_payment_event', 'run_maintenance', 'hit_rate_limit', 'claim_outbox', 'finish_outbox', 'submit_contact', 'newsletter_subscribe', 'newsletter_unsubscribe', 'order_projection']) {
        expect(names).not.toContain(serverOnly);
      }
      for (const fn of ['create_order', 'get_order_for_access', 'hit_rate_limit']) {
        const ok = (await db.main.query(`select has_function_privilege('service_role', p.oid, 'execute') as ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn])).rows[0].ok;
        expect(ok).toBe(true);
      }
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query("select public.get_order_for_access($1, $2)", [orderGuest.order_number, sha256('x')])));
      await expectDenied(asUser(db.main, ids.customerA, (c) => c.query('select private.fail($1)', ['x'])));
    });
  });

  describe('server (service role)', () => {
    it('can call the checkout functions and nothing exposes the private schema through the API roles', async () => {
      const ok = (await asService(db.main, (c) => c.query("select public.hit_rate_limit('test', 2, 60) as ok"))).rows[0].ok;
      expect(ok).toBe(true);
      const usage = (await db.main.query("select has_schema_privilege('anon', 'private', 'usage') as anon, has_schema_privilege('authenticated', 'private', 'usage') as auth")).rows[0];
      expect(usage).toEqual({ anon: false, auth: false });
      expect(checkoutPayload([]).shipping_method).toBe('standard');
    });
  });
});
