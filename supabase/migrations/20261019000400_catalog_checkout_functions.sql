-- Catalogue helpers, quoting, atomic order creation, payment events and stock handling.
-- Conventions: SECURITY DEFINER functions set search_path = '' and schema-qualify everything.
-- Errors are raised as  ov_error:<code>  (SQLSTATE P0001) with an optional JSON detail.
-- Execute grants are set explicitly in the grants migration; nothing is callable by default.

create or replace function private.get_setting(p_key text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select s.value from public.store_settings s where s.key = p_key),
    (select s.value from private.settings s where s.key = p_key)
  );
$$;

create or replace function private.fail(p_code text, p_detail jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_detail is null then
    raise exception 'ov_error:%', p_code using errcode = 'P0001';
  else
    raise exception 'ov_error:%', p_code using errcode = 'P0001', detail = p_detail::text;
  end if;
end;
$$;

-- ---------------------------------------------------------------- public catalogue helpers
-- Exact stock counts are never public: only booleans.
create or replace function public.catalog_availability(p_variant_ids uuid[])
returns table (variant_id uuid, in_stock boolean, low_stock boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id,
         (i.stock_verified and (i.on_hand - i.reserved) > 0),
         (i.stock_verified and (i.on_hand - i.reserved) > 0 and (i.on_hand - i.reserved) <= i.low_stock_threshold)
  from public.product_variants v
  join public.products p on p.id = v.product_id and p.status = 'published'
  join public.inventory i on i.variant_id = v.id
  where v.id = any (p_variant_ids[1:200]) and v.active;
$$;

create or replace function public.search_catalog(p_query text, p_limit integer default 24)
returns table (slug text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := btrim(coalesce(p_query, ''));
  tokens text[];
  lim integer := greatest(1, least(coalesce(p_limit, 24), 50));
begin
  if char_length(q) = 0 or char_length(q) > 80 then
    return;
  end if;
  tokens := regexp_split_to_array(lower(q), '\s+');
  if cardinality(tokens) > 6 then
    tokens := tokens[1:6];
  end if;
  return query
  select p.slug
  from public.products p
  left join public.brands b on b.id = p.brand_id
  where p.status = 'published'
    and not exists (
      select 1 from unnest(tokens) as t(tok)
      where not (
        lower(p.name) like '%' || replace(replace(replace(t.tok, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        or lower(coalesce(b.name, '')) like '%' || replace(replace(replace(t.tok, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        or lower(coalesce(p.style, '')) like '%' || replace(replace(replace(t.tok, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        or exists (
          select 1 from public.product_variants v
          where v.product_id = p.id and v.active
            and lower(coalesce(v.color_name, '')) like '%' || replace(replace(replace(t.tok, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        )
      )
    )
  order by p.sort_order, p.name
  limit lim;
end;
$$;
create index if not exists products_name_lower_idx on public.products (lower(name) text_pattern_ops);

-- ---------------------------------------------------------------- readiness
create or replace function public.product_readiness(p_product_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  problems text[] := '{}';
  prod public.products;
begin
  if not public.is_admin() then
    perform private.fail('forbidden');
  end if;
  select * into prod from public.products where id = p_product_id;
  if not found then
    return array['product_not_found'];
  end if;
  if not exists (select 1 from public.product_variants v where v.product_id = prod.id and v.active) then
    problems := array_append(problems, 'no_active_variant');
  end if;
  if exists (select 1 from public.product_variants v where v.product_id = prod.id and v.active and v.price_pkr <= 0) then
    problems := array_append(problems, 'price_missing');
  end if;
  if exists (
    select 1 from public.product_variants v join public.inventory i on i.variant_id = v.id
    where v.product_id = prod.id and v.active and not i.stock_verified
  ) then
    problems := array_append(problems, 'stock_not_verified');
  end if;
  if not exists (
    select 1 from public.product_images im
    where im.product_id = prod.id and im.is_cover and im.approval_status = 'approved'
  ) then
    problems := array_append(problems, 'no_approved_cover_image');
  end if;
  return problems;
end;
$$;

create or replace function private.guard_product_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  problems text[] := '{}';
begin
  if new.status = 'archived' then
    new.ready_to_sell := false;
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if tg_op = 'UPDATE' and not exists (select 1 from public.product_variants v where v.product_id = new.id and v.active) then
      problems := array_append(problems, 'no_active_variant');
    end if;
    if exists (select 1 from public.categories c where c.id = new.category_id and not c.active) then
      problems := array_append(problems, 'category_inactive');
    end if;
    if cardinality(problems) > 0 then
      perform private.fail('not_publishable', to_jsonb(problems));
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  if new.ready_to_sell and (tg_op = 'INSERT' or not old.ready_to_sell) then
    if tg_op = 'INSERT' then
      perform private.fail('not_ready_to_sell', '["new_product_cannot_be_ready"]'::jsonb);
    end if;
    if exists (select 1 from public.product_variants v where v.product_id = new.id and v.active and v.price_pkr <= 0) then
      problems := array_append(problems, 'price_missing');
    end if;
    if exists (
      select 1 from public.product_variants v join public.inventory i on i.variant_id = v.id
      where v.product_id = new.id and v.active and not i.stock_verified
    ) then
      problems := array_append(problems, 'stock_not_verified');
    end if;
    if not exists (select 1 from public.product_variants v where v.product_id = new.id and v.active) then
      problems := array_append(problems, 'no_active_variant');
    end if;
    if not exists (select 1 from public.product_images im where im.product_id = new.id and im.is_cover and im.approval_status = 'approved') then
      problems := array_append(problems, 'no_approved_cover_image');
    end if;
    if cardinality(problems) > 0 then
      perform private.fail('not_ready_to_sell', to_jsonb(problems));
    end if;
  end if;
  return new;
end;
$$;
create trigger products_guard before insert or update on public.products for each row execute function private.guard_product_state();

-- ---------------------------------------------------------------- stock handling (callers hold the order row lock)
create or replace function private.release_order_reservations(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  -- Lock inventory rows in a fixed order (variant id ascending) to avoid deadlocks.
  perform 1 from public.inventory i
   where i.variant_id in (select sr.variant_id from public.stock_reservations sr where sr.order_id = p_order_id and sr.status = 'active')
   order by i.variant_id for update;
  for r in
    select sr.id, sr.variant_id, sr.quantity from public.stock_reservations sr
     where sr.order_id = p_order_id and sr.status = 'active' order by sr.variant_id
  loop
    update public.stock_reservations set status = 'released', resolved_at = now() where id = r.id and status = 'active';
    if found then
      update public.inventory set reserved = reserved - r.quantity, updated_at = now() where variant_id = r.variant_id;
      insert into public.inventory_movements (variant_id, kind, delta_reserved, reason, order_id)
      values (r.variant_id, 'release', -r.quantity, left(p_reason, 300), p_order_id);
    end if;
  end loop;
  update public.orders set stock_state = 'released' where id = p_order_id and stock_state = 'reserved';
end;
$$;

create or replace function private.commit_order_reservations(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  perform 1 from public.inventory i
   where i.variant_id in (select sr.variant_id from public.stock_reservations sr where sr.order_id = p_order_id and sr.status = 'active')
   order by i.variant_id for update;
  for r in
    select sr.id, sr.variant_id, sr.quantity from public.stock_reservations sr
     where sr.order_id = p_order_id and sr.status = 'active' order by sr.variant_id
  loop
    update public.stock_reservations set status = 'committed', resolved_at = now() where id = r.id and status = 'active';
    if found then
      update public.inventory set on_hand = on_hand - r.quantity, reserved = reserved - r.quantity, updated_at = now() where variant_id = r.variant_id;
      insert into public.inventory_movements (variant_id, kind, delta_on_hand, delta_reserved, reason, order_id)
      values (r.variant_id, 'commit_reservation', -r.quantity, -r.quantity, 'payment confirmed', p_order_id);
    end if;
  end loop;
  update public.orders set stock_state = 'committed' where id = p_order_id and stock_state = 'reserved';
end;
$$;

-- Puts committed stock back after a cancel of an order that never shipped. At most once per order.
create or replace function private.restock_cancelled_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.stock_state = 'committed') then
    return;
  end if;
  perform 1 from public.inventory i
   where i.variant_id in (select oi.variant_id from public.order_items oi where oi.order_id = p_order_id and oi.variant_id is not null)
   order by i.variant_id for update;
  for r in
    select oi.variant_id, sum(oi.quantity)::integer as qty from public.order_items oi
     where oi.order_id = p_order_id and oi.variant_id is not null group by oi.variant_id order by oi.variant_id
  loop
    update public.inventory set on_hand = on_hand + r.qty, updated_at = now() where variant_id = r.variant_id;
    insert into public.inventory_movements (variant_id, kind, delta_on_hand, reason, order_id)
    values (r.variant_id, 'cancel_restock', r.qty, 'order cancelled before shipping', p_order_id);
  end loop;
  update public.orders set stock_state = 'restocked' where id = p_order_id;
end;
$$;

-- Expired online-payment reservations are released (lazily by checkout and by the maintenance job).
create or replace function private.expire_stale_orders(p_variant_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  n integer := 0;
begin
  for o in
    select distinct sr.order_id from public.stock_reservations sr
     where sr.status = 'active' and sr.expires_at <= now()
       and (p_variant_ids is null or sr.variant_id = any (p_variant_ids))
     order by sr.order_id
  loop
    perform 1 from public.orders x where x.id = o.order_id for update;
    if exists (select 1 from public.orders x where x.id = o.order_id and x.stock_state = 'reserved' and x.payment_status = 'pending') then
      perform private.release_order_reservations(o.order_id, 'payment window expired');
      update public.orders set payment_status = 'failed', fulfilment_status = 'cancelled', cancelled_at = now(), cancel_reason = 'payment_window_expired'
       where id = o.order_id;
      insert into public.order_events (order_id, kind, from_state, to_state, actor_kind, message)
      values (o.order_id, 'payment_expired', 'pending', 'failed', 'system', 'The payment window expired and the items were released.');
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------- quoting
-- Builds the server-derived quote. Locks nothing itself; create_order locks inventory first.
create or replace function private.build_quote(
  p_lines jsonb,
  p_shipping_method text,
  p_province text,
  p_payment_method text,
  p_check_stock boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  max_lines integer := coalesce((private.get_setting('max_lines'))::text::integer, 20);
  max_qty integer := coalesce((private.get_setting('max_quantity_per_line'))::text::integer, 9);
  e jsonb;
  merged jsonb;
  line record;
  out_lines jsonb := '[]'::jsonb;
  subtotal bigint := 0;
  avail integer;
  pay public.payment_methods;
  meth public.shipping_methods;
  v_zone text;
  rate public.shipping_rates;
  ship integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    perform private.fail('invalid_lines');
  end if;
  for e in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(e) <> 'object'
       or coalesce(e ->> 'variant_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(e ->> 'quantity', '') !~ '^[0-9]{1,3}$' then
      perform private.fail('invalid_lines');
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('variant_id', m.vid, 'quantity', m.qty) order by m.vid)
    into merged
    from (select (x ->> 'variant_id')::uuid as vid, sum((x ->> 'quantity')::integer) as qty
            from jsonb_array_elements(p_lines) x group by 1) m;
  if jsonb_array_length(merged) > max_lines then
    perform private.fail('too_many_lines');
  end if;

  for line in
    select (m ->> 'variant_id')::uuid as variant_id, (m ->> 'quantity')::integer as qty
      from jsonb_array_elements(merged) m order by 1
  loop
    if line.qty < 1 or line.qty > max_qty then
      perform private.fail('invalid_quantity', jsonb_build_object('variant_id', line.variant_id, 'max', max_qty));
    end if;
    declare
      v public.product_variants;
      p public.products;
      inv public.inventory;
      cover text;
    begin
      select * into v from public.product_variants where id = line.variant_id;
      if not found or not v.active then
        perform private.fail('variant_unavailable', jsonb_build_object('variant_id', line.variant_id));
      end if;
      select * into p from public.products where id = v.product_id;
      if p.status <> 'published' or not p.ready_to_sell or v.price_pkr <= 0 then
        perform private.fail('variant_unavailable', jsonb_build_object('variant_id', line.variant_id));
      end if;
      select * into inv from public.inventory where variant_id = v.id;
      if not found or not inv.stock_verified then
        perform private.fail('variant_unavailable', jsonb_build_object('variant_id', line.variant_id));
      end if;
      if p_check_stock then
        avail := inv.on_hand - inv.reserved;
        if avail < line.qty then
          perform private.fail('insufficient_stock', jsonb_build_object('variant_id', line.variant_id, 'available', greatest(avail, 0)));
        end if;
      end if;
      select im.bucket || '/' || im.path into cover from public.product_images im
        where im.product_id = p.id and im.is_cover and im.approval_status = 'approved' limit 1;
      subtotal := subtotal + (v.price_pkr::bigint * line.qty);
      out_lines := out_lines || jsonb_build_array(jsonb_build_object(
        'variant_id', v.id, 'sku', v.sku, 'product_slug', p.slug, 'product_name', p.name,
        'color', v.color_name, 'size', v.size_label, 'unit_price_pkr', v.price_pkr, 'quantity', line.qty,
        'line_total_pkr', v.price_pkr * line.qty, 'image_path', cover));
    end;
  end loop;
  if subtotal > 1000000000 then
    perform private.fail('amount_too_large');
  end if;

  select * into pay from public.payment_methods where code = p_payment_method;
  if not found or not pay.enabled then
    perform private.fail('payment_method_unavailable');
  end if;
  select * into meth from public.shipping_methods where code = p_shipping_method;
  if not found or not meth.enabled then
    perform private.fail('shipping_unavailable');
  end if;
  select z.code into v_zone
    from public.shipping_zones z
    join public.shipping_rates r on r.zone_code = z.code and r.method_code = meth.code and r.enabled
   where z.provinces is null or lower(btrim(coalesce(p_province, ''))) = any (select lower(btrim(x)) from unnest(z.provinces) x)
   order by (z.provinces is null), z.code
   limit 1;
  if v_zone is null then
    perform private.fail('shipping_unavailable');
  end if;
  select * into rate from public.shipping_rates where method_code = meth.code and shipping_rates.zone_code = v_zone;
  ship := case when rate.free_over_pkr is not null and subtotal >= rate.free_over_pkr then 0 else rate.price_pkr end;

  return jsonb_build_object(
    'currency', 'PKR',
    'lines', out_lines,
    'subtotal_pkr', subtotal,
    'shipping_pkr', ship,
    'shipping_method', jsonb_build_object('code', meth.code, 'label', meth.label, 'estimate_text', meth.estimate_text),
    'tax_pkr', 0,
    'tax_status', 'not_calculated',
    'total_pkr', subtotal + ship,
    'payment_method', jsonb_build_object('code', pay.code, 'label', pay.label, 'kind', pay.kind)
  );
end;
$$;

-- Read-only quote for the checkout review step (called by the quote-order Edge Function).
create or replace function public.quote_order(p_lines jsonb, p_shipping_method text, p_province text, p_payment_method text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce((private.get_setting('ordering_enabled'))::text::boolean, false) is not true then
    perform private.fail('ordering_closed');
  end if;
  return private.build_quote(p_lines, p_shipping_method, p_province, p_payment_method, true);
end;
$$;

-- ---------------------------------------------------------------- order creation
create or replace function private.norm_text(p_value jsonb, p_min integer, p_max integer, p_code text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then
    if p_min = 0 then return ''; end if;
    perform private.fail('invalid_field', jsonb_build_object('field', p_code));
  end if;
  t := btrim(regexp_replace(p_value #>> '{}', '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
  if char_length(t) < p_min or char_length(t) > p_max then
    perform private.fail('invalid_field', jsonb_build_object('field', p_code));
  end if;
  return t;
end;
$$;

create or replace function public.create_order(
  p_order_id uuid,
  p_user_id uuid,
  p_scope_hash bytea,
  p_idempotency_key text,
  p_payload jsonb,
  p_expected_total integer,
  p_token_hash bytea,
  p_is_test boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  contact jsonb := p_payload -> 'contact';
  addr jsonb := p_payload -> 'address';
  v_name text;
  v_email text;
  v_phone text;
  a_recipient text; a_phone text; a_line1 text; a_line2 text; a_city text; a_province text; a_postal text;
  v_ship text := p_payload ->> 'shipping_method';
  v_pay text := p_payload ->> 'payment_method';
  merged jsonb;
  variant_ids uuid[];
  fingerprint bytea;
  inserted integer;
  existing private.checkout_requests;
  quote jsonb;
  pay public.payment_methods;
  v_order public.orders;
  v_state text;
  v_payment_status text;
  v_expires timestamptz;
  v_reserve_minutes integer := coalesce((private.get_setting('reservation_minutes'))::text::integer, 30);
  v_token_days integer := coalesce((private.get_setting('order_access_days'))::text::integer, 90);
  item jsonb;
  new_number text;
begin
  if coalesce((private.get_setting('ordering_enabled'))::text::boolean, false) is not true then
    perform private.fail('ordering_closed');
  end if;
  if p_scope_hash is null or octet_length(p_scope_hash) <> 32 or p_token_hash is null or octet_length(p_token_hash) <> 32 then
    perform private.fail('invalid_request');
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 100 then
    perform private.fail('invalid_idempotency_key');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or contact is null or addr is null
     or jsonb_typeof(contact) <> 'object' or jsonb_typeof(addr) <> 'object' then
    perform private.fail('invalid_request');
  end if;

  v_name := private.norm_text(contact -> 'name', 1, 120, 'name');
  v_email := lower(private.norm_text(contact -> 'email', 3, 254, 'email'));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform private.fail('invalid_field', '{"field":"email"}'::jsonb);
  end if;
  v_phone := private.norm_text(contact -> 'phone', 5, 30, 'phone');
  if v_phone !~ '^\+?[0-9][0-9 ()\-]{3,28}[0-9]$' then
    perform private.fail('invalid_field', '{"field":"phone"}'::jsonb);
  end if;
  a_recipient := private.norm_text(coalesce(addr -> 'recipient', to_jsonb(v_name)), 1, 120, 'recipient');
  a_phone := private.norm_text(coalesce(addr -> 'phone', to_jsonb(v_phone)), 5, 30, 'address_phone');
  a_line1 := private.norm_text(addr -> 'line1', 1, 200, 'line1');
  a_line2 := private.norm_text(addr -> 'line2', 0, 200, 'line2');
  a_city := private.norm_text(addr -> 'city', 1, 80, 'city');
  a_province := private.norm_text(addr -> 'province', 1, 80, 'province');
  a_postal := private.norm_text(addr -> 'postal_code', 0, 12, 'postal_code');
  if coalesce(addr ->> 'country', 'PK') <> 'PK' then
    perform private.fail('invalid_field', '{"field":"country"}'::jsonb);
  end if;
  if v_ship is null or v_pay is null or v_ship !~ '^[a-z0-9_]+$' or v_pay !~ '^[a-z0-9_]+$' then
    perform private.fail('invalid_request');
  end if;

  -- Canonical, order-independent line list; its sha256 plus the other inputs is the request fingerprint.
  if jsonb_typeof(p_payload -> 'lines') <> 'array' or jsonb_array_length(p_payload -> 'lines') = 0 or jsonb_array_length(p_payload -> 'lines') > 100 then
    perform private.fail('invalid_lines');
  end if;
  for item in select * from jsonb_array_elements(p_payload -> 'lines') loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'variant_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(item ->> 'quantity', '') !~ '^[0-9]{1,3}$' then
      perform private.fail('invalid_lines');
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('variant_id', m.vid, 'quantity', m.qty) order by m.vid), array_agg(m.vid order by m.vid)
    into merged, variant_ids
    from (select (x ->> 'variant_id')::uuid as vid, sum((x ->> 'quantity')::integer) as qty
            from jsonb_array_elements(p_payload -> 'lines') x group by 1) m;
  fingerprint := sha256(convert_to(jsonb_build_object(
    'lines', merged, 'shipping', v_ship, 'payment', v_pay, 'name', v_name, 'email', v_email, 'phone', v_phone,
    'address', jsonb_build_object('recipient', a_recipient, 'phone', a_phone, 'line1', a_line1, 'line2', a_line2, 'city', a_city, 'province', a_province, 'postal', a_postal)
  )::text, 'UTF8'));

  -- Idempotency. A concurrent identical request waits here for the first to commit, then replays it.
  insert into private.checkout_requests (scope_hash, idempotency_key, fingerprint)
  values (p_scope_hash, p_idempotency_key, fingerprint)
  on conflict (scope_hash, idempotency_key) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    select * into existing from private.checkout_requests where scope_hash = p_scope_hash and idempotency_key = p_idempotency_key;
    if existing.fingerprint is distinct from fingerprint then
      perform private.fail('idempotency_conflict');
    end if;
    if existing.order_id is null then
      perform private.fail('request_in_progress');
    end if;
    select * into v_order from public.orders where id = existing.order_id;
    return jsonb_build_object('replayed', true, 'order_id', v_order.id, 'order_number', v_order.order_number,
      'payment_status', v_order.payment_status, 'fulfilment_status', v_order.fulfilment_status, 'total_pkr', v_order.total_pkr);
  end if;

  -- Lock stock rows in a fixed order, then release anything expired for these variants.
  perform 1 from public.inventory i where i.variant_id = any (variant_ids) order by i.variant_id for update;
  perform private.expire_stale_orders(variant_ids);

  quote := private.build_quote(merged, v_ship, a_province, v_pay, true);
  if p_expected_total is null or (quote ->> 'total_pkr')::integer <> p_expected_total then
    perform private.fail('price_changed', quote);
  end if;

  select * into pay from public.payment_methods where code = v_pay;
  if pay.kind = 'cod' then
    v_state := 'committed';
    v_payment_status := 'unpaid';
  else
    v_state := 'reserved';
    v_payment_status := 'pending';
    v_expires := now() + make_interval(mins => v_reserve_minutes);
  end if;

  new_number := private.new_order_number();
  insert into public.orders (
    id, order_number, user_id, customer_email, customer_name, customer_phone, shipping_address,
    subtotal_pkr, shipping_pkr, tax_pkr, tax_status, total_pkr, payment_method_code, payment_method_label,
    payment_status, fulfilment_status, shipping_method_code, shipping_method_label, stock_state, is_test)
  values (
    p_order_id, new_number, p_user_id, v_email, v_name, v_phone,
    jsonb_build_object('recipient', a_recipient, 'phone', a_phone, 'line1', a_line1, 'line2', a_line2,
                       'city', a_city, 'province', a_province, 'postal_code', a_postal, 'country', 'PK'),
    (quote ->> 'subtotal_pkr')::integer, (quote ->> 'shipping_pkr')::integer, 0, 'not_calculated', (quote ->> 'total_pkr')::integer,
    pay.code, pay.label, v_payment_status, 'unfulfilled', quote -> 'shipping_method' ->> 'code', quote -> 'shipping_method' ->> 'label', v_state, coalesce(p_is_test, false))
  returning * into v_order;

  insert into public.order_items (order_id, variant_id, product_slug, sku, product_name, color, size, unit_price_pkr, quantity, line_total_pkr, image_path)
  select v_order.id, (l ->> 'variant_id')::uuid, l ->> 'product_slug', l ->> 'sku', l ->> 'product_name', l ->> 'color', l ->> 'size',
         (l ->> 'unit_price_pkr')::integer, (l ->> 'quantity')::integer, (l ->> 'line_total_pkr')::integer, l ->> 'image_path'
    from jsonb_array_elements(quote -> 'lines') l;

  if pay.kind = 'cod' then
    update public.inventory i set on_hand = i.on_hand - q.qty, updated_at = now()
      from (select (l ->> 'variant_id')::uuid as vid, (l ->> 'quantity')::integer as qty from jsonb_array_elements(quote -> 'lines') l) q
     where i.variant_id = q.vid;
    insert into public.inventory_movements (variant_id, kind, delta_on_hand, reason, order_id)
    select (l ->> 'variant_id')::uuid, 'sale', -(l ->> 'quantity')::integer, 'order placed (cash on delivery)', v_order.id
      from jsonb_array_elements(quote -> 'lines') l;
  else
    update public.inventory i set reserved = i.reserved + q.qty, updated_at = now()
      from (select (l ->> 'variant_id')::uuid as vid, (l ->> 'quantity')::integer as qty from jsonb_array_elements(quote -> 'lines') l) q
     where i.variant_id = q.vid;
    insert into public.stock_reservations (order_id, variant_id, quantity, expires_at)
    select v_order.id, (l ->> 'variant_id')::uuid, (l ->> 'quantity')::integer, v_expires from jsonb_array_elements(quote -> 'lines') l;
    insert into public.inventory_movements (variant_id, kind, delta_reserved, reason, order_id)
    select (l ->> 'variant_id')::uuid, 'reserve', (l ->> 'quantity')::integer, 'online payment pending', v_order.id
      from jsonb_array_elements(quote -> 'lines') l;
  end if;

  insert into private.order_access_tokens (order_id, token_hash, expires_at)
  values (v_order.id, p_token_hash, now() + make_interval(days => v_token_days))
  on conflict (token_hash) do nothing;

  insert into public.order_events (order_id, kind, to_state, actor_kind, actor_id, message)
  values (v_order.id, 'order_placed', v_order.fulfilment_status, case when p_user_id is null then 'customer' else 'customer' end, p_user_id,
          case when pay.kind = 'cod' then 'Order received. Payment is due on delivery.' else 'Order received. Waiting for payment.' end);

  insert into public.notification_outbox (kind, dedupe_key, payload)
  values ('order_confirmation', 'order:' || v_order.id || ':confirmation', jsonb_build_object('order_id', v_order.id)),
         ('admin_new_order', 'order:' || v_order.id || ':admin', jsonb_build_object('order_id', v_order.id))
  on conflict (dedupe_key) do nothing;

  update private.checkout_requests set order_id = v_order.id where scope_hash = p_scope_hash and idempotency_key = p_idempotency_key;

  return jsonb_build_object('replayed', false, 'order_id', v_order.id, 'order_number', v_order.order_number,
    'payment_status', v_order.payment_status, 'fulfilment_status', v_order.fulfilment_status, 'total_pkr', v_order.total_pkr,
    'payment_method', jsonb_build_object('code', pay.code, 'kind', pay.kind), 'expires_at', v_expires);
end;
$$;

-- Customer-safe projection for a guest holding a valid access capability. The caller (an Edge Function)
-- rate-limits and passes only the SHA-256 of the presented token.
create or replace function public.get_order_for_access(p_order_number text, p_token_hash bytea)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  if p_order_number is null or p_token_hash is null or octet_length(p_token_hash) <> 32 then
    return null;
  end if;
  select ord.* into o
    from public.orders ord
    join private.order_access_tokens t on t.order_id = ord.id
   where ord.order_number = p_order_number and t.token_hash = p_token_hash
     and t.revoked_at is null and t.expires_at > now();
  if not found then
    return null;
  end if;
  return public.order_projection(o.id);
end;
$$;

create or replace function public.order_projection(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_number', o.order_number,
    'placed_at', o.placed_at,
    'customer_name', o.customer_name,
    'email_hint', regexp_replace(o.customer_email, '^(.).*(@.*)$', '\1***\2'),
    'shipping_address', o.shipping_address,
    'currency', o.currency,
    'subtotal_pkr', o.subtotal_pkr, 'shipping_pkr', o.shipping_pkr, 'tax_pkr', o.tax_pkr, 'tax_status', o.tax_status, 'total_pkr', o.total_pkr,
    'payment_method', o.payment_method_label, 'payment_status', o.payment_status,
    'fulfilment_status', o.fulfilment_status,
    'shipping_method', o.shipping_method_label,
    'tracking_carrier', o.tracking_carrier, 'tracking_number', o.tracking_number, 'tracking_url', o.tracking_url,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'product_slug', i.product_slug, 'product_name', i.product_name, 'sku', i.sku, 'color', i.color, 'size', i.size,
        'unit_price_pkr', i.unit_price_pkr, 'quantity', i.quantity, 'line_total_pkr', i.line_total_pkr, 'image_path', i.image_path)
        order by i.created_at, i.id) from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'message', e.message, 'created_at', e.created_at) order by e.created_at, e.id)
        from public.order_events e where e.order_id = o.id and e.visible_to_customer), '[]'::jsonb)
  )
  from public.orders o where o.id = p_order_id;
$$;

-- ---------------------------------------------------------------- payment events (provider adapters call this)
create or replace function public.apply_payment_event(
  p_provider text,
  p_event_id text,
  p_order_id uuid,
  p_amount_pkr integer,
  p_currency text,
  p_status text,
  p_external_ref text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.orders;
  inserted integer;
  result text;
begin
  if p_status not in ('succeeded', 'failed', 'cancelled') then
    perform private.fail('invalid_request');
  end if;
  insert into private.webhook_events (provider, event_id, order_id) values (p_provider, p_event_id, p_order_id)
  on conflict (provider, event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return jsonb_build_object('result', 'duplicate');     -- replay protection
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    update private.webhook_events set status = 'rejected', note = 'unknown order' where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object('result', 'rejected');
  end if;
  if p_currency is distinct from o.currency or p_amount_pkr is distinct from o.total_pkr then
    update private.webhook_events set status = 'rejected', note = 'amount or currency mismatch' where provider = p_provider and event_id = p_event_id;
    update public.orders set needs_attention = true, attention_reason = 'payment_amount_mismatch' where id = o.id;
    return jsonb_build_object('result', 'rejected');
  end if;

  insert into public.payment_attempts (order_id, provider, external_ref, amount_pkr, status)
  values (o.id, p_provider, coalesce(p_external_ref, p_event_id), p_amount_pkr,
          case p_status when 'succeeded' then 'succeeded' when 'failed' then 'failed' else 'cancelled' end)
  on conflict (provider, external_ref) do update set status = excluded.status;

  if p_status = 'succeeded' then
    if o.payment_status = 'paid' then
      result := 'ignored';                       -- already paid: out-of-order or repeated
    elsif o.stock_state = 'reserved' then
      perform private.commit_order_reservations(o.id);
      update public.orders set payment_status = 'paid' where id = o.id;
      insert into public.order_events (order_id, kind, from_state, to_state, actor_kind, message)
      values (o.id, 'payment_confirmed', o.payment_status, 'paid', 'system', 'Payment confirmed.');
      result := 'processed';
    else
      -- Paid after the reservation was released (expiry or cancel): never silently oversell; flag for an admin.
      update public.orders set payment_status = 'paid', needs_attention = true, attention_reason = 'payment_after_release' where id = o.id;
      insert into public.order_events (order_id, kind, from_state, to_state, actor_kind, message, visible_to_customer)
      values (o.id, 'payment_after_release', o.payment_status, 'paid', 'system', 'Payment arrived after the items were released. Needs admin reconciliation.', false);
      result := 'needs_reconciliation';
    end if;
  else
    if o.payment_status = 'paid' then
      result := 'ignored';                       -- a late failure cannot undo a confirmed payment
    elsif o.stock_state = 'reserved' then
      perform private.release_order_reservations(o.id, 'payment ' || p_status);
      update public.orders set payment_status = 'failed', fulfilment_status = 'cancelled', cancelled_at = now(), cancel_reason = 'payment_' || p_status where id = o.id;
      insert into public.order_events (order_id, kind, from_state, to_state, actor_kind, message)
      values (o.id, 'payment_failed', o.payment_status, 'failed', 'system', 'Payment was not completed. The items were released.');
      result := 'processed';
    else
      result := 'ignored';
    end if;
  end if;
  update private.webhook_events set status = case when result = 'processed' then 'processed' else 'ignored' end, note = result
   where provider = p_provider and event_id = p_event_id;
  return jsonb_build_object('result', result);
end;
$$;

-- ---------------------------------------------------------------- maintenance, rate limit, outbox
create or replace function public.run_maintenance()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  expired integer;
  pruned integer;
begin
  expired := private.expire_stale_orders(null);
  delete from private.rate_limits where window_start < now() - interval '1 day';
  get diagnostics pruned = row_count;
  return jsonb_build_object('expired_orders', expired, 'rate_limit_rows_pruned', pruned);
end;
$$;

-- Atomic fixed-window counter. Returns true when the call is allowed.
create or replace function public.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  if p_key is null or p_max < 1 or p_window_seconds < 1 then
    return false;
  end if;
  insert into private.rate_limits (bucket_key, window_start, hits) values (left(p_key, 200), w, 1)
  on conflict (bucket_key, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into n;
  return n <= p_max;
end;
$$;

create or replace function public.claim_outbox(p_limit integer default 10)
returns setof public.notification_outbox
language sql
volatile
security definer
set search_path = ''
as $$
  update public.notification_outbox o
     set attempts = o.attempts + 1, next_attempt_at = now() + interval '5 minutes' * least(o.attempts + 1, 12)
   where o.id in (
     select x.id from public.notification_outbox x
      where x.status in ('pending', 'failed') and x.next_attempt_at <= now() and x.attempts < 8
      order by x.created_at limit greatest(1, least(p_limit, 50))
      for update skip locked)
  returning o.*;
$$;

create or replace function public.finish_outbox(p_id uuid, p_status text, p_error text default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.notification_outbox
     set status = case when p_status in ('sent', 'skipped') then p_status else 'failed' end,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         last_error = left(p_error, 300)
   where id = p_id;
$$;

-- ---------------------------------------------------------------- support (called by Edge Functions)
create or replace function public.submit_contact(p_payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  topics text[];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    perform private.fail('invalid_request');
  end if;
  select coalesce(array_agg(left(t, 40)), '{}') into topics
    from (select jsonb_array_elements_text(case when jsonb_typeof(p_payload -> 'topics') = 'array' then p_payload -> 'topics' else '[]'::jsonb end) as t limit 8) s;
  insert into public.contact_messages (kind, first_name, last_name, email, phone, topics, order_number, message)
  values (
    case when p_payload ->> 'kind' = 'return_request' then 'return_request' else 'contact' end,
    private.norm_text(p_payload -> 'first_name', 1, 80, 'first_name'),
    private.norm_text(p_payload -> 'last_name', 0, 80, 'last_name'),
    lower(private.norm_text(p_payload -> 'email', 3, 254, 'email')),
    private.norm_text(p_payload -> 'phone', 0, 30, 'phone'),
    topics,
    nullif(private.norm_text(p_payload -> 'order_number', 0, 40, 'order_number'), ''),
    private.norm_text(p_payload -> 'message', 1, 4000, 'message'))
  returning id into new_id;
  insert into public.notification_outbox (kind, dedupe_key, payload)
  values ('admin_new_contact_message', 'contact:' || new_id, jsonb_build_object('message_id', new_id));
  return new_id;
end;
$$;

create or replace function public.newsletter_subscribe(p_email text, p_consent_text text, p_source text, p_token_hash bytea)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    perform private.fail('invalid_field', '{"field":"email"}'::jsonb);
  end if;
  if p_token_hash is null or octet_length(p_token_hash) <> 32 or coalesce(char_length(p_consent_text), 0) not between 1 and 500 then
    perform private.fail('invalid_request');
  end if;
  -- Re-subscribing an existing address is a silent no-op (no disclosure of who is subscribed),
  -- except that an unsubscribed address may opt in again with fresh consent evidence.
  insert into public.newsletter_subscriptions (email, consent_text, source, unsubscribe_token_hash)
  values (v_email, p_consent_text, left(coalesce(p_source, 'footer'), 40), p_token_hash)
  on conflict (lower(email)) do update
    set unsubscribed_at = null, consent_text = excluded.consent_text, consent_at = now(), unsubscribe_token_hash = excluded.unsubscribe_token_hash
    where public.newsletter_subscriptions.unsubscribed_at is not null;
end;
$$;

create or replace function public.newsletter_unsubscribe(p_token_hash bytea)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.newsletter_subscriptions set unsubscribed_at = now()
   where unsubscribe_token_hash = p_token_hash and unsubscribed_at is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
