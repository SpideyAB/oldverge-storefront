-- Admin operations. Every function re-checks public.is_admin() (current protected membership)
-- on every call; hiding admin navigation is never the control. Functions run as the owner so they can
-- touch tables that have no direct client write grants (inventory, orders, refunds ...).

create or replace function private.require_admin(p_owner_only boolean default false)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if not public.is_admin() then
    raise exception 'ov_error:forbidden' using errcode = '42501';
  end if;
  if p_owner_only and public.admin_role() <> 'owner' then
    raise exception 'ov_error:owner_only' using errcode = '42501';
  end if;
  return uid;
end;
$$;

create or replace function private.audit_action(p_actor uuid, p_action text, p_entity text, p_entity_id text, p_after jsonb default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.admin_audit_log (actor_id, action, entity, entity_id, after_data) values (p_actor, p_action, p_entity, p_entity_id, p_after);
$$;

-- ---------------------------------------------------------------- inventory
create or replace function public.admin_adjust_inventory(
  p_variant_id uuid,
  p_mode text,
  p_quantity integer,
  p_reason text,
  p_op_key text default null,
  p_verify boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  inv public.inventory;
  new_on_hand integer;
  delta integer;
  prior_verified boolean;
  existing public.inventory_movements;
begin
  if p_mode not in ('set', 'delta') or p_quantity is null or char_length(btrim(coalesce(p_reason, ''))) < 3 then
    perform private.fail('invalid_request');
  end if;
  if p_op_key is not null then
    select * into existing from public.inventory_movements where op_key = p_op_key;
    if found then
      select * into inv from public.inventory where variant_id = existing.variant_id;
      return jsonb_build_object('replayed', true, 'on_hand', inv.on_hand, 'reserved', inv.reserved);
    end if;
  end if;
  select * into inv from public.inventory where variant_id = p_variant_id for update;
  if not found then
    perform private.fail('variant_unavailable');
  end if;
  prior_verified := inv.stock_verified;
  new_on_hand := case p_mode when 'set' then p_quantity else inv.on_hand + p_quantity end;
  if new_on_hand < 0 or new_on_hand > 1000000 then
    perform private.fail('invalid_quantity');
  end if;
  if new_on_hand < inv.reserved then
    perform private.fail('below_reserved', jsonb_build_object('reserved', inv.reserved));
  end if;
  delta := new_on_hand - inv.on_hand;
  update public.inventory
     set on_hand = new_on_hand,
         stock_verified = case when p_verify then true else stock_verified end,
         verified_at = case when p_verify then now() else verified_at end,
         verified_by = case when p_verify then actor else verified_by end,
         updated_at = now()
   where variant_id = p_variant_id;
  insert into public.inventory_movements (variant_id, kind, delta_on_hand, reason, actor_id, op_key)
  values (p_variant_id, case when not prior_verified and p_mode = 'set' then 'initial_count' else 'adjustment' end, delta, left(btrim(p_reason), 300), actor, p_op_key);
  return jsonb_build_object('replayed', false, 'on_hand', new_on_hand, 'reserved', inv.reserved);
end;
$$;

create or replace function public.admin_set_low_stock_threshold(p_variant_id uuid, p_threshold integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
begin
  if p_threshold is null or p_threshold < 0 or p_threshold > 100000 then
    perform private.fail('invalid_quantity');
  end if;
  update public.inventory set low_stock_threshold = p_threshold, updated_at = now() where variant_id = p_variant_id;
  perform private.audit_action(actor, 'update', 'public.inventory', p_variant_id::text, jsonb_build_object('low_stock_threshold', p_threshold));
end;
$$;

-- ---------------------------------------------------------------- images
create or replace function public.admin_approve_image(p_image_id uuid, p_public_path text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
begin
  if p_public_path is null or char_length(p_public_path) not between 3 and 300 or p_public_path ~ '\.\.' or p_public_path ~ '^/' then
    perform private.fail('invalid_request');
  end if;
  -- Approval needs provenance recorded (source and licence) so a stand-in is never approved by accident.
  if exists (select 1 from public.product_images im where im.id = p_image_id and (coalesce(btrim(im.source_name), '') = '' or coalesce(btrim(im.licence), '') = '')) then
    perform private.fail('provenance_required');
  end if;
  update public.product_images
     set bucket = 'product-public', path = p_public_path, approval_status = 'approved', approved_by = actor, approved_at = now()
   where id = p_image_id;
  if not found then
    perform private.fail('not_found');
  end if;
end;
$$;

create or replace function public.admin_reject_image(p_image_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
begin
  update public.product_images set approval_status = 'rejected', is_cover = false where id = p_image_id and bucket = 'product-private';
  if not found then
    perform private.fail('not_found');
  end if;
  perform private.audit_action(actor, 'reject', 'public.product_images', p_image_id::text);
end;
$$;

create or replace function public.admin_delete_draft_product(p_product_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
begin
  if not exists (select 1 from public.products p where p.id = p_product_id and p.status = 'draft') then
    perform private.fail('only_drafts_can_be_deleted');
  end if;
  if exists (select 1 from public.order_items oi join public.product_variants v on v.id = oi.variant_id where v.product_id = p_product_id) then
    perform private.fail('product_has_orders');
  end if;
  delete from public.products where id = p_product_id;
  perform private.audit_action(actor, 'delete_draft', 'public.products', p_product_id::text);
end;
$$;

-- ---------------------------------------------------------------- store readiness and ordering switch
create or replace function public.admin_ordering_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  problems text[] := '{}';
begin
  perform private.require_admin();
  if not exists (select 1 from public.payment_methods where enabled) then problems := array_append(problems, 'no_enabled_payment_method'); end if;
  if not exists (
    select 1 from public.shipping_methods m join public.shipping_rates r on r.method_code = m.code and r.enabled
     where m.enabled) then problems := array_append(problems, 'no_enabled_shipping_rate'); end if;
  if not exists (
    select 1 from public.products p join public.product_variants v on v.product_id = p.id and v.active and v.price_pkr > 0
      join public.inventory i on i.variant_id = v.id and i.stock_verified
     where p.status = 'published' and p.ready_to_sell) then problems := array_append(problems, 'no_purchasable_product'); end if;
  if not exists (
    select 1 from public.store_settings s
     where s.key in ('contact.email', 'contact.phone', 'contact.whatsapp') and s.value <> 'null'::jsonb and s.value <> '""'::jsonb) then problems := array_append(problems, 'no_contact_channel'); end if;
  if exists (
    select 1 from public.policy_pages pp
     -- Seeded placeholder text does not count: an admin must have published each policy (updated_by is set by admin_publish_policy).
       where pp.slug in ('shipping', 'refund-policy', 'privacy-policy', 'terms-and-conditions') and (pp.published_at is null or pp.updated_by is null)) then problems := array_append(problems, 'policies_not_published'); end if;
  return jsonb_build_object('ready', cardinality(problems) = 0, 'problems', to_jsonb(problems));
end;
$$;

create or replace function public.admin_set_ordering_enabled(p_enabled boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin(true);
  readiness jsonb;
begin
  if p_enabled then
    readiness := public.admin_ordering_readiness();
    if not (readiness ->> 'ready')::boolean then
      perform private.fail('not_ready_for_ordering', readiness -> 'problems');
    end if;
  end if;
  perform set_config('oldverge.ordering_toggle', 'on', true);
  update public.store_settings set value = to_jsonb(p_enabled), updated_by = actor where key = 'ordering_enabled';
  perform set_config('oldverge.ordering_toggle', 'off', true);
  return jsonb_build_object('ordering_enabled', p_enabled);
end;
$$;

create or replace function public.admin_publish_policy(p_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin(true);
  v integer;
begin
  update public.policy_pages pp
     set published_sections = d.sections, version = pp.version + 1, published_at = now(), updated_by = actor
    from public.policy_drafts d
   where pp.slug = p_slug and d.slug = pp.slug and jsonb_array_length(d.sections) > 0
  returning pp.version into v;
  if not found then
    perform private.fail('policy_draft_empty');
  end if;
  return jsonb_build_object('slug', p_slug, 'version', v);
end;
$$;

-- ---------------------------------------------------------------- orders
create or replace function private.add_event(p_order_id uuid, p_kind text, p_from text, p_to text, p_actor uuid, p_message text, p_visible boolean default true)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.order_events (order_id, kind, from_state, to_state, actor_kind, actor_id, message, visible_to_customer)
  values (p_order_id, p_kind, p_from, p_to, 'admin', p_actor, left(coalesce(p_message, ''), 500), p_visible);
$$;

create or replace function public.admin_set_fulfilment(p_order_id uuid, p_to text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  o public.orders;
  allowed boolean;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then perform private.fail('not_found'); end if;
  -- Transition matrix. Cancellation has its own function (it also handles stock and refunds).
  allowed := (o.fulfilment_status = 'unfulfilled' and p_to = 'processing')
          or (o.fulfilment_status = 'processing' and p_to = 'shipped')
          or (o.fulfilment_status = 'shipped' and p_to = 'delivered');
  if not allowed then
    perform private.fail('invalid_transition', jsonb_build_object('from', o.fulfilment_status, 'to', p_to));
  end if;
  if p_to in ('processing', 'shipped') and o.payment_status in ('pending', 'failed') then
    perform private.fail('payment_not_settled');
  end if;
  update public.orders set fulfilment_status = p_to where id = o.id;
  perform private.add_event(o.id, 'fulfilment_' || p_to, o.fulfilment_status, p_to, actor, coalesce(p_note, 'Order ' || p_to || '.'));
  return jsonb_build_object('fulfilment_status', p_to);
end;
$$;

create or replace function public.admin_record_shipment(
  p_order_id uuid, p_carrier text, p_tracking_number text, p_tracking_url text default null, p_mark_shipped boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  o public.orders;
  new_status text;
begin
  if char_length(btrim(coalesce(p_carrier, ''))) not between 1 and 80
     or char_length(btrim(coalesce(p_tracking_number, ''))) not between 1 and 80
     or (p_tracking_url is not null and (p_tracking_url !~ '^https://[^\s]{4,250}$')) then
    perform private.fail('invalid_request');
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then perform private.fail('not_found'); end if;
  if o.fulfilment_status in ('cancelled', 'delivered') then
    perform private.fail('invalid_transition', jsonb_build_object('from', o.fulfilment_status));
  end if;
  new_status := o.fulfilment_status;
  if p_mark_shipped and o.fulfilment_status in ('unfulfilled', 'processing') then
    if o.payment_status in ('pending', 'failed') then perform private.fail('payment_not_settled'); end if;
    new_status := 'shipped';
  end if;
  update public.orders
     set tracking_carrier = btrim(p_carrier), tracking_number = btrim(p_tracking_number), tracking_url = p_tracking_url, fulfilment_status = new_status
   where id = o.id;
  perform private.add_event(o.id, 'shipment_recorded', o.fulfilment_status, new_status, actor,
    'Dispatched with ' || btrim(p_carrier) || ', tracking ' || btrim(p_tracking_number) || '. (Recorded manually.)');
  return jsonb_build_object('fulfilment_status', new_status);
end;
$$;

create or replace function public.admin_cancel_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  o public.orders;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then perform private.fail('invalid_request'); end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then perform private.fail('not_found'); end if;
  if o.fulfilment_status not in ('unfulfilled', 'processing') then
    perform private.fail('invalid_transition', jsonb_build_object('from', o.fulfilment_status, 'to', 'cancelled'));
  end if;
  if o.stock_state = 'reserved' then
    perform private.release_order_reservations(o.id, 'order cancelled');
  elsif o.stock_state = 'committed' then
    perform private.restock_cancelled_order(o.id);
  end if;
  update public.orders
     set fulfilment_status = 'cancelled', cancelled_at = now(), cancel_reason = left(btrim(p_reason), 300),
         payment_status = case when payment_status = 'pending' then 'failed' else payment_status end,
         needs_attention = case when payment_status in ('paid', 'partially_refunded') then true else needs_attention end,
         attention_reason = case when payment_status in ('paid', 'partially_refunded') then 'refund_required' else attention_reason end
   where id = o.id;
  perform private.add_event(o.id, 'order_cancelled', o.fulfilment_status, 'cancelled', actor, 'Order cancelled.');
  return jsonb_build_object('fulfilment_status', 'cancelled', 'refund_required', o.payment_status in ('paid', 'partially_refunded'));
end;
$$;

-- Cash on delivery: the admin records that the courier handed over the money.
create or replace function public.admin_mark_cod_paid(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then perform private.fail('not_found'); end if;
  if o.payment_status <> 'unpaid' or o.fulfilment_status = 'cancelled'
     or not exists (select 1 from public.payment_methods pm where pm.code = o.payment_method_code and pm.kind = 'cod') then
    perform private.fail('invalid_transition', jsonb_build_object('from', o.payment_status));
  end if;
  update public.orders set payment_status = 'paid' where id = o.id;
  perform private.add_event(o.id, 'payment_recorded', 'unpaid', 'paid', actor, 'Cash payment recorded.');
end;
$$;

create or replace function public.admin_add_order_note(p_order_id uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
begin
  insert into public.order_notes (order_id, author_id, note) values (p_order_id, actor, left(btrim(p_note), 2000));
end;
$$;

create or replace function public.admin_clear_attention(p_order_id uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
begin
  if char_length(btrim(coalesce(p_note, ''))) < 3 then perform private.fail('invalid_request'); end if;
  update public.orders set needs_attention = false, attention_reason = null where id = p_order_id;
  insert into public.order_notes (order_id, author_id, note) values (p_order_id, actor, 'Attention cleared: ' || left(btrim(p_note), 1900));
end;
$$;

create or replace function public.admin_revoke_order_access(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
begin
  update private.order_access_tokens set revoked_at = now() where order_id = p_order_id and revoked_at is null;
  perform private.audit_action(actor, 'revoke_access', 'public.orders', p_order_id::text);
end;
$$;

-- ---------------------------------------------------------------- returns and refunds (manual records)
create or replace function public.admin_create_return(p_order_id uuid, p_reason text, p_items jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  rid uuid;
  it jsonb;
  oi public.order_items;
  already integer;
begin
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform private.fail('invalid_request');
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id) then perform private.fail('not_found'); end if;
  insert into public.order_returns (order_id, reason, created_by) values (p_order_id, btrim(p_reason), actor) returning id into rid;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into oi from public.order_items where id = (it ->> 'order_item_id')::uuid and order_id = p_order_id;
    if not found or coalesce(it ->> 'quantity', '') !~ '^[0-9]{1,2}$' then perform private.fail('invalid_request'); end if;
    select coalesce(sum(ri.quantity), 0) into already from public.order_return_items ri
      join public.order_returns r on r.id = ri.return_id where ri.order_item_id = oi.id and r.status <> 'rejected' and r.id <> rid;
    if (it ->> 'quantity')::integer < 1 or (it ->> 'quantity')::integer + already > oi.quantity then
      perform private.fail('invalid_quantity', jsonb_build_object('order_item_id', oi.id));
    end if;
    insert into public.order_return_items (return_id, order_item_id, quantity) values (rid, oi.id, (it ->> 'quantity')::integer);
  end loop;
  perform private.add_event(p_order_id, 'return_opened', null, 'requested', actor, 'A return was opened for this order.', true);
  return rid;
end;
$$;

create or replace function public.admin_set_return_status(p_return_id uuid, p_to text, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  r public.order_returns;
  allowed boolean;
begin
  select * into r from public.order_returns where id = p_return_id for update;
  if not found then perform private.fail('not_found'); end if;
  allowed := (r.status = 'requested' and p_to in ('approved', 'rejected'))
          or (r.status = 'approved' and p_to = 'received')
          or (r.status in ('rejected', 'received') and p_to = 'closed');
  if not allowed then perform private.fail('invalid_transition', jsonb_build_object('from', r.status, 'to', p_to)); end if;
  update public.order_returns set status = p_to, admin_note = coalesce(left(p_note, 500), admin_note) where id = r.id;
  perform private.add_event(r.order_id, 'return_' || p_to, r.status, p_to, actor, 'Return ' || p_to || '.', true);
end;
$$;

-- Returned goods go back on sale only after an admin confirms they are sellable, and only once.
create or replace function public.admin_restock_return_item(p_return_item_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  ri public.order_return_items;
  r public.order_returns;
  oi public.order_items;
begin
  select * into ri from public.order_return_items where id = p_return_item_id for update;
  if not found then perform private.fail('not_found'); end if;
  select * into r from public.order_returns where id = ri.return_id;
  if r.status <> 'received' or ri.restocked_at is not null then
    perform private.fail('invalid_transition', jsonb_build_object('status', r.status));
  end if;
  select * into oi from public.order_items where id = ri.order_item_id;
  if oi.variant_id is null then perform private.fail('variant_unavailable'); end if;
  perform 1 from public.inventory where variant_id = oi.variant_id for update;
  update public.inventory set on_hand = on_hand + ri.quantity, updated_at = now() where variant_id = oi.variant_id;
  insert into public.inventory_movements (variant_id, kind, delta_on_hand, reason, order_id, actor_id)
  values (oi.variant_id, 'return_restock', ri.quantity, 'returned item confirmed sellable', r.order_id, actor);
  update public.order_return_items set restocked_at = now() where id = ri.id;
end;
$$;

create or replace function public.admin_request_refund(p_order_id uuid, p_amount_pkr integer, p_note text, p_return_id uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  o public.orders;
  confirmed_total integer;
  open_total integer;
  rid uuid;
begin
  if p_amount_pkr is null or p_amount_pkr < 1 or char_length(btrim(coalesce(p_note, ''))) < 3 then perform private.fail('invalid_request'); end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then perform private.fail('not_found'); end if;
  if o.payment_status not in ('paid', 'partially_refunded') then perform private.fail('nothing_to_refund'); end if;
  select coalesce(sum(amount_pkr) filter (where status = 'confirmed'), 0), coalesce(sum(amount_pkr) filter (where status = 'requested'), 0)
    into confirmed_total, open_total from public.refunds where order_id = o.id;
  if confirmed_total + open_total + p_amount_pkr > o.total_pkr then perform private.fail('refund_exceeds_total'); end if;
  -- Only manual refunds can be recorded here. Provider refunds need a configured provider adapter.
  insert into public.refunds (order_id, return_id, amount_pkr, method, note, requested_by)
  values (o.id, p_return_id, p_amount_pkr, 'manual', left(btrim(p_note), 500), actor) returning id into rid;
  return rid;
end;
$$;

-- Marks money as returned. Only this audited confirmation changes the order's payment state.
create or replace function public.admin_confirm_refund(p_refund_id uuid, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  rf public.refunds;
  o public.orders;
  confirmed_total integer;
  new_status text;
begin
  if char_length(btrim(coalesce(p_note, ''))) < 3 then perform private.fail('invalid_request'); end if;
  select * into rf from public.refunds where id = p_refund_id for update;
  if not found then perform private.fail('not_found'); end if;
  if rf.status <> 'requested' or rf.method <> 'manual' then perform private.fail('invalid_transition', jsonb_build_object('from', rf.status)); end if;
  select * into o from public.orders where id = rf.order_id for update;
  update public.refunds set status = 'confirmed', confirmed_by = actor, confirmed_at = now(), note = left(rf.note || ' | confirmed: ' || btrim(p_note), 500) where id = rf.id;
  select coalesce(sum(amount_pkr), 0) into confirmed_total from public.refunds where order_id = o.id and status = 'confirmed';
  new_status := case when confirmed_total >= o.total_pkr then 'refunded' else 'partially_refunded' end;
  update public.orders set payment_status = new_status, needs_attention = case when attention_reason = 'refund_required' then false else needs_attention end,
         attention_reason = case when attention_reason = 'refund_required' then null else attention_reason end where id = o.id;
  perform private.add_event(o.id, 'refund_confirmed', o.payment_status, new_status, actor, 'A refund of PKR ' || rf.amount_pkr || ' was recorded as returned to you.');
  return jsonb_build_object('payment_status', new_status);
end;
$$;

-- ---------------------------------------------------------------- dashboard and export
create or replace function public.admin_dashboard_stats(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f timestamptz := coalesce(p_from, now() - interval '30 days');
  t timestamptz := coalesce(p_to, now());
  result jsonb;
begin
  perform private.require_admin();
  select jsonb_build_object(
    'from', f, 'to', t,
    -- Revenue: real (non-test) orders that are paid or partly refunded and not cancelled, minus confirmed refunds.
    'revenue_pkr', coalesce((select sum(o.total_pkr) from public.orders o
        where o.placed_at between f and t and not o.is_test and o.fulfilment_status <> 'cancelled'
          and o.payment_status in ('paid', 'partially_refunded')), 0)
      - coalesce((select sum(r.amount_pkr) from public.refunds r join public.orders o on o.id = r.order_id
        where r.status = 'confirmed' and o.placed_at between f and t and not o.is_test and o.fulfilment_status <> 'cancelled'), 0),
    'awaiting_cod_pkr', coalesce((select sum(o.total_pkr) from public.orders o
        where o.placed_at between f and t and not o.is_test and o.fulfilment_status <> 'cancelled' and o.payment_status = 'unpaid'), 0),
    'orders_total', (select count(*) from public.orders o where o.placed_at between f and t and not o.is_test),
    'by_fulfilment', coalesce((select jsonb_object_agg(s.fulfilment_status, s.n) from (
        select o.fulfilment_status, count(*) as n from public.orders o where o.placed_at between f and t and not o.is_test group by 1) s), '{}'::jsonb),
    'by_payment', coalesce((select jsonb_object_agg(s.payment_status, s.n) from (
        select o.payment_status, count(*) as n from public.orders o where o.placed_at between f and t and not o.is_test group by 1) s), '{}'::jsonb),
    'needs_attention', (select count(*) from public.orders o where o.needs_attention),
    'unread_messages', (select count(*) from public.contact_messages m where m.status = 'new'),
    'failed_notifications', (select count(*) from public.notification_outbox n where n.status = 'failed'),
    'low_stock', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('variant_id', v.id, 'sku', v.sku, 'product', p.name, 'available', i.on_hand - i.reserved, 'threshold', i.low_stock_threshold) as x
          from public.inventory i join public.product_variants v on v.id = i.variant_id join public.products p on p.id = v.product_id
         where i.stock_verified and v.active and p.status = 'published' and (i.on_hand - i.reserved) <= i.low_stock_threshold
         order by (i.on_hand - i.reserved), p.name limit 20) q), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_export_orders(p_from timestamptz, p_to timestamptz, p_limit integer default 1000)
returns table (
  order_number text, placed_at timestamptz, customer_name text, customer_email text, customer_phone text, city text, province text,
  payment_method text, payment_status text, fulfilment_status text, subtotal_pkr integer, shipping_pkr integer, total_pkr integer, is_test boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  lim integer := greatest(1, least(coalesce(p_limit, 1000), 5000));
begin
  perform private.audit_action(actor, 'export', 'public.orders', null, jsonb_build_object('from', p_from, 'to', p_to, 'limit', lim));
  return query
  select o.order_number, o.placed_at, o.customer_name, o.customer_email, o.customer_phone,
         o.shipping_address ->> 'city', o.shipping_address ->> 'province',
         o.payment_method_label, o.payment_status, o.fulfilment_status, o.subtotal_pkr, o.shipping_pkr, o.total_pkr, o.is_test
    from public.orders o
   where o.placed_at between coalesce(p_from, now() - interval '30 days') and coalesce(p_to, now())
   order by o.placed_at desc limit lim;
end;
$$;

create or replace function public.admin_run_maintenance()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return public.run_maintenance();
end;
$$;
