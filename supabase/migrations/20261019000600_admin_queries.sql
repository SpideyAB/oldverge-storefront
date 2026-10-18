-- Admin read models for orders. Customers read their own orders with a column-restricted SELECT;
-- admins read everything (including internal flags and notes) only through these functions.

create or replace function public.admin_list_orders(
  p_search text default null,
  p_fulfilment text default null,
  p_payment text default null,
  p_attention boolean default null,
  p_include_test boolean default true,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim integer := greatest(1, least(coalesce(p_limit, 25), 100));
  off integer := greatest(0, coalesce(p_offset, 0));
  pattern text;
  total bigint;
  rows jsonb;
begin
  perform private.require_admin();
  pattern := case when coalesce(btrim(p_search), '') = '' then null
                  else '%' || replace(replace(replace(lower(left(btrim(p_search), 80)), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  select count(*) into total from public.orders o
   where (pattern is null or lower(o.order_number) like pattern escape '\' or lower(o.customer_email) like pattern escape '\' or lower(o.customer_name) like pattern escape '\')
     and (p_fulfilment is null or o.fulfilment_status = p_fulfilment)
     and (p_payment is null or o.payment_status = p_payment)
     and (p_attention is null or o.needs_attention = p_attention)
     and (coalesce(p_include_test, true) or not o.is_test);
  select coalesce(jsonb_agg(r order by r.placed_at desc), '[]'::jsonb) into rows from (
    select o.id, o.order_number, o.placed_at, o.customer_name, o.customer_email, o.total_pkr, o.payment_status, o.fulfilment_status,
           o.payment_method_label, o.needs_attention, o.attention_reason, o.is_test,
           (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = o.id) as item_count
      from public.orders o
     where (pattern is null or lower(o.order_number) like pattern escape '\' or lower(o.customer_email) like pattern escape '\' or lower(o.customer_name) like pattern escape '\')
       and (p_fulfilment is null or o.fulfilment_status = p_fulfilment)
       and (p_payment is null or o.payment_status = p_payment)
       and (p_attention is null or o.needs_attention = p_attention)
       and (coalesce(p_include_test, true) or not o.is_test)
     order by o.placed_at desc limit lim offset off) r;
  return jsonb_build_object('total', total, 'rows', rows);
end;
$$;

create or replace function public.admin_get_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_admin();
  select jsonb_build_object(
    'order', to_jsonb(o) - 'user_id',
    'has_account', o.user_id is not null,
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at, i.id) from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at, e.id) from public.order_events e where e.order_id = o.id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from public.order_notes n where n.order_id = o.id), '[]'::jsonb),
    'payment_attempts', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.payment_attempts p where p.order_id = o.id), '[]'::jsonb),
    'reservations', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.stock_reservations s where s.order_id = o.id), '[]'::jsonb),
    'returns', coalesce((select jsonb_agg(jsonb_build_object('return', to_jsonb(r),
        'items', coalesce((select jsonb_agg(to_jsonb(ri)) from public.order_return_items ri where ri.return_id = r.id), '[]'::jsonb)) order by r.created_at)
        from public.order_returns r where r.order_id = o.id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at) from public.refunds f where f.order_id = o.id), '[]'::jsonb)
  ) into result
  from public.orders o where o.id = p_order_id;
  if result is null then
    perform private.fail('not_found');
  end if;
  return result;
end;
$$;
