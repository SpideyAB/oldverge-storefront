-- Row-level security policies, explicit table/column grants, function EXECUTE grants and Storage.
-- Nothing is granted by default. Every grant below is deliberate and is asserted by supabase/tests.

-- ---------------------------------------------------------------- start from nothing
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------- public catalogue (read)
create policy categories_read on public.categories for select to anon, authenticated using (active or public.is_admin());
create policy categories_admin_write on public.categories for insert to authenticated with check (public.is_admin());
create policy categories_admin_update on public.categories for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy brands_read on public.brands for select to anon, authenticated using (active or public.is_admin());
create policy brands_admin_write on public.brands for insert to authenticated with check (public.is_admin());
create policy brands_admin_update on public.brands for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy products_read on public.products for select to anon, authenticated using (status = 'published' or public.is_admin());
create policy products_admin_write on public.products for insert to authenticated with check (public.is_admin());
create policy products_admin_update on public.products for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy variants_read on public.product_variants for select to anon, authenticated
  using (public.is_admin() or (active and exists (select 1 from public.products p where p.id = product_id and p.status = 'published')));
create policy variants_admin_write on public.product_variants for insert to authenticated with check (public.is_admin());
create policy variants_admin_update on public.product_variants for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy images_read on public.product_images for select to anon, authenticated
  using (public.is_admin() or (approval_status = 'approved' and bucket = 'product-public'
        and exists (select 1 from public.products p where p.id = product_id and p.status = 'published')));
create policy images_admin_write on public.product_images for insert to authenticated with check (public.is_admin());
create policy images_admin_update on public.product_images for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy images_admin_delete on public.product_images for delete to authenticated using (public.is_admin());

create policy site_images_read on public.site_images for select to anon, authenticated
  using (public.is_admin() or (approval_status = 'approved' and bucket = 'product-public'));
create policy site_images_admin_write on public.site_images for insert to authenticated with check (public.is_admin());
create policy site_images_admin_update on public.site_images for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.categories, public.brands, public.products, public.product_variants, public.product_images, public.site_images to anon, authenticated;
grant insert, update on public.categories, public.brands, public.products, public.product_variants, public.product_images, public.site_images to authenticated;
grant delete on public.product_images to authenticated;

-- ---------------------------------------------------------------- settings, shipping, payment, policies
create policy store_settings_read on public.store_settings for select to anon, authenticated using (is_public or public.is_admin());
create policy store_settings_admin_insert on public.store_settings for insert to authenticated with check (public.is_admin());
create policy store_settings_admin_update on public.store_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.store_settings to anon, authenticated;
grant insert, update (value, is_public) on public.store_settings to authenticated;

create policy shipping_zones_read on public.shipping_zones for select to anon, authenticated using (true);
create policy shipping_zones_admin_write on public.shipping_zones for insert to authenticated with check (public.is_admin());
create policy shipping_zones_admin_update on public.shipping_zones for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy shipping_methods_read on public.shipping_methods for select to anon, authenticated using (enabled or public.is_admin());
create policy shipping_methods_admin_write on public.shipping_methods for insert to authenticated with check (public.is_admin());
create policy shipping_methods_admin_update on public.shipping_methods for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy shipping_rates_read on public.shipping_rates for select to anon, authenticated using (public.is_admin() or (enabled and exists (select 1 from public.shipping_methods m where m.code = method_code and m.enabled)));
create policy shipping_rates_admin_write on public.shipping_rates for insert to authenticated with check (public.is_admin());
create policy shipping_rates_admin_update on public.shipping_rates for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy payment_methods_read on public.payment_methods for select to anon, authenticated using (enabled or public.is_admin());
create policy payment_methods_admin_write on public.payment_methods for insert to authenticated with check (public.is_admin());
create policy payment_methods_admin_update on public.payment_methods for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.shipping_zones, public.shipping_methods, public.shipping_rates, public.payment_methods to anon, authenticated;
grant insert, update on public.shipping_zones, public.shipping_methods, public.shipping_rates, public.payment_methods to authenticated;

create policy policy_pages_read on public.policy_pages for select to anon, authenticated using (published_at is not null or public.is_admin());
create policy policy_pages_admin_update on public.policy_pages for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.policy_pages to anon, authenticated;
grant update (title) on public.policy_pages to authenticated;
create policy policy_drafts_admin_select on public.policy_drafts for select to authenticated using (public.is_admin());
create policy policy_drafts_admin_update on public.policy_drafts for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.policy_drafts to authenticated;
grant update (sections) on public.policy_drafts to authenticated;

-- ---------------------------------------------------------------- customers
create policy profiles_own_select on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_own_update on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.profiles to authenticated;
grant update (display_name, phone) on public.profiles to authenticated;

create policy addresses_own_select on public.addresses for select to authenticated using (user_id = (select auth.uid()));
create policy addresses_own_insert on public.addresses for insert to authenticated with check (user_id = (select auth.uid()));
create policy addresses_own_update on public.addresses for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy addresses_own_delete on public.addresses for delete to authenticated using (user_id = (select auth.uid()));
grant select, delete on public.addresses to authenticated;
grant insert (label, recipient, phone, line1, line2, city, province, postal_code, is_default) on public.addresses to authenticated;
grant update (label, recipient, phone, line1, line2, city, province, postal_code, is_default) on public.addresses to authenticated;

-- ---------------------------------------------------------------- orders (customers read their own, nothing else)
create policy orders_own_select on public.orders for select to authenticated using (user_id = (select auth.uid()));
-- user_id and visible_to_customer must be selectable because the row policies read them as the caller.
grant select (id, user_id, order_number, placed_at, customer_name, customer_email, customer_phone, shipping_address, currency,
              subtotal_pkr, shipping_pkr, tax_pkr, tax_status, total_pkr, payment_method_code, payment_method_label, payment_status,
              fulfilment_status, shipping_method_code, shipping_method_label, tracking_carrier, tracking_number, tracking_url,
              cancelled_at, cancel_reason, created_at, updated_at)
  on public.orders to authenticated;

create policy order_items_own_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));
grant select on public.order_items to authenticated;

create policy order_events_own_select on public.order_events for select to authenticated
  using (visible_to_customer and exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));
grant select (id, order_id, kind, from_state, to_state, message, visible_to_customer, created_at) on public.order_events to authenticated;

-- ---------------------------------------------------------------- admin-only reads (no customer access at all)
create policy order_notes_admin on public.order_notes for select to authenticated using (public.is_admin());
create policy payment_attempts_admin on public.payment_attempts for select to authenticated using (public.is_admin());
create policy inventory_admin on public.inventory for select to authenticated using (public.is_admin());
create policy inventory_movements_admin on public.inventory_movements for select to authenticated using (public.is_admin());
create policy stock_reservations_admin on public.stock_reservations for select to authenticated using (public.is_admin());
create policy order_returns_admin on public.order_returns for select to authenticated using (public.is_admin());
create policy order_return_items_admin on public.order_return_items for select to authenticated using (public.is_admin());
create policy refunds_admin on public.refunds for select to authenticated using (public.is_admin());
create policy outbox_admin on public.notification_outbox for select to authenticated using (public.is_admin());
create policy audit_admin on public.admin_audit_log for select to authenticated using (public.is_admin());
grant select on public.order_notes, public.payment_attempts, public.inventory, public.inventory_movements, public.stock_reservations,
                public.order_returns, public.order_return_items, public.refunds, public.notification_outbox, public.admin_audit_log to authenticated;

create policy contact_messages_admin_select on public.contact_messages for select to authenticated using (public.is_admin());
create policy contact_messages_admin_update on public.contact_messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.contact_messages to authenticated;
grant update (status, admin_note) on public.contact_messages to authenticated;

create policy newsletter_admin_select on public.newsletter_subscriptions for select to authenticated using (public.is_admin());
grant select (id, email, consent_text, consent_at, source, unsubscribed_at, created_at) on public.newsletter_subscriptions to authenticated;

-- ---------------------------------------------------------------- function EXECUTE grants
-- Policy expressions run as the caller, so the identity helpers must be callable.
grant execute on function public.is_admin(), public.admin_role() to anon, authenticated;
grant execute on function public.catalog_availability(uuid[]), public.search_catalog(text, integer) to anon, authenticated;

-- Admin operations: callable by signed-in users but every one re-checks protected admin membership.
grant execute on function
  public.product_readiness(uuid),
  public.admin_adjust_inventory(uuid, text, integer, text, text, boolean),
  public.admin_set_low_stock_threshold(uuid, integer),
  public.admin_approve_image(uuid, text),
  public.admin_reject_image(uuid),
  public.admin_delete_draft_product(uuid),
  public.admin_ordering_readiness(),
  public.admin_set_ordering_enabled(boolean),
  public.admin_publish_policy(text),
  public.admin_set_fulfilment(uuid, text, text),
  public.admin_record_shipment(uuid, text, text, text, boolean),
  public.admin_cancel_order(uuid, text),
  public.admin_mark_cod_paid(uuid),
  public.admin_add_order_note(uuid, text),
  public.admin_clear_attention(uuid, text),
  public.admin_revoke_order_access(uuid),
  public.admin_create_return(uuid, text, jsonb),
  public.admin_set_return_status(uuid, text, text),
  public.admin_restock_return_item(uuid),
  public.admin_request_refund(uuid, integer, text, uuid),
  public.admin_confirm_refund(uuid, text),
  public.admin_dashboard_stats(timestamptz, timestamptz),
  public.admin_export_orders(timestamptz, timestamptz, integer),
  public.admin_run_maintenance(),
  public.admin_list_orders(text, text, text, boolean, boolean, integer, integer),
  public.admin_get_order(uuid)
  to authenticated;

-- Server-only operations: the Edge Functions call these with the service role after their own checks.
grant execute on function
  public.quote_order(jsonb, text, text, text),
  public.create_order(uuid, uuid, bytea, text, jsonb, integer, bytea, boolean),
  public.get_order_for_access(text, bytea),
  public.order_projection(uuid),
  public.apply_payment_event(text, text, uuid, integer, text, text, text),
  public.run_maintenance(),
  public.hit_rate_limit(text, integer, integer),
  public.claim_outbox(integer),
  public.finish_outbox(uuid, text, text),
  public.submit_contact(jsonb),
  public.newsletter_subscribe(text, text, text, bytea),
  public.newsletter_unsubscribe(bytea)
  to service_role;
grant usage on schema private to service_role;

-- ---------------------------------------------------------------- Storage
-- product-public: approved, world-readable images only. product-private: unapproved originals and drafts
-- (admin only; a public bucket cannot hide drafts, so they never go there). order-private: attachments,
-- readable only through short-lived signed URLs issued by a server function (no client policies).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-public', 'product-public', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('product-private', 'product-private', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('order-private', 'order-private', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "product-public read" on storage.objects for select to anon, authenticated using (bucket_id = 'product-public');
create policy "product-public admin insert" on storage.objects for insert to authenticated with check (bucket_id = 'product-public' and public.is_admin());
create policy "product-public admin update" on storage.objects for update to authenticated using (bucket_id = 'product-public' and public.is_admin()) with check (bucket_id = 'product-public' and public.is_admin());
create policy "product-public admin delete" on storage.objects for delete to authenticated using (bucket_id = 'product-public' and public.is_admin());
create policy "product-private admin select" on storage.objects for select to authenticated using (bucket_id = 'product-private' and public.is_admin());
create policy "product-private admin insert" on storage.objects for insert to authenticated with check (bucket_id = 'product-private' and public.is_admin());
create policy "product-private admin update" on storage.objects for update to authenticated using (bucket_id = 'product-private' and public.is_admin()) with check (bucket_id = 'product-private' and public.is_admin());
create policy "product-private admin delete" on storage.objects for delete to authenticated using (bucket_id = 'product-private' and public.is_admin());
