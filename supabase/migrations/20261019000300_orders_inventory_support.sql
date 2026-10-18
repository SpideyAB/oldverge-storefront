-- Orders, immutable snapshots, inventory, reservations, returns/refunds, support records,
-- notification outbox and the admin audit log.

-- ---------------------------------------------------------------- orders
create or replace function private.new_order_number()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  candidate text;
begin
  loop
    -- Non-sequential, readable, unique: OV-<yymmdd>-<8 hex>.
    candidate := 'OV-' || to_char(now() at time zone 'utc', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.orders o where o.order_number = candidate);
  end loop;
  return candidate;
end;
$$;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid references auth.users (id) on delete set null,
  customer_email text not null check (char_length(customer_email) between 3 and 254),
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  customer_phone text not null check (char_length(customer_phone) between 5 and 30),
  -- Historical snapshot: later address edits never change an order.
  shipping_address jsonb not null check (jsonb_typeof(shipping_address) = 'object'),
  currency text not null default 'PKR' check (currency = 'PKR'),
  subtotal_pkr integer not null check (subtotal_pkr >= 0),
  shipping_pkr integer not null check (shipping_pkr >= 0),
  tax_pkr integer not null default 0 check (tax_pkr >= 0),
  tax_status text not null default 'not_calculated' check (tax_status in ('not_calculated', 'included', 'added')),
  total_pkr integer not null check (total_pkr >= 0),
  payment_method_code text not null,
  payment_method_label text not null,
  payment_status text not null check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded')),
  fulfilment_status text not null default 'unfulfilled' check (fulfilment_status in ('unfulfilled', 'processing', 'shipped', 'delivered', 'cancelled')),
  shipping_method_code text not null,
  shipping_method_label text not null,
  tracking_carrier text,
  tracking_number text,
  tracking_url text,
  -- reserved: held for a pending online payment; committed: removed from on_hand;
  -- released: reservation given back (expiry, failure or cancel); restocked: committed stock returned by a cancel.
  stock_state text not null check (stock_state in ('reserved', 'committed', 'released', 'restocked')),
  needs_attention boolean not null default false,
  attention_reason text,
  is_test boolean not null default false,
  placed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_pkr = subtotal_pkr + shipping_pkr + tax_pkr)
);
create index orders_user_idx on public.orders (user_id, placed_at desc);
create index orders_status_idx on public.orders (fulfilment_status, payment_status, placed_at desc);
create index orders_placed_idx on public.orders (placed_at desc);
create index orders_email_idx on public.orders (lower(customer_email));

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete set null,
  product_slug text not null,
  sku text not null,
  product_name text not null,
  color text,
  size text,
  unit_price_pkr integer not null check (unit_price_pkr >= 0),
  quantity integer not null check (quantity between 1 and 99),
  line_total_pkr integer not null check (line_total_pkr >= 0),
  image_path text,
  created_at timestamptz not null default now(),
  check (line_total_pkr = unit_price_pkr * quantity)
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_variant_idx on public.order_items (variant_id) where variant_id is not null;

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 60),
  from_state text,
  to_state text,
  actor_kind text not null check (actor_kind in ('system', 'customer', 'admin')),
  actor_id uuid,
  message text not null default '' check (char_length(message) <= 500),
  visible_to_customer boolean not null default true,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

-- Internal notes: admin only, never shown to customers.
create table public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  author_id uuid,
  note text not null check (char_length(note) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index order_notes_order_idx on public.order_notes (order_id, created_at);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null,
  external_ref text,
  amount_pkr integer not null check (amount_pkr >= 0),
  currency text not null default 'PKR' check (currency = 'PKR'),
  status text not null check (status in ('created', 'pending', 'succeeded', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_ref)
);
create index payment_attempts_order_idx on public.payment_attempts (order_id);

-- Guest access: only a hash of an unguessable capability is stored, never the token itself.
create table private.order_access_tokens (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index order_access_tokens_order_idx on private.order_access_tokens (order_id);

-- Idempotency: one row per (scope, key). scope_hash is the hash of the signed-in user id or of the
-- guest checkout secret, so nobody can read or replay another checkout by guessing a key.
create table private.checkout_requests (
  scope_hash bytea not null check (octet_length(scope_hash) = 32),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 100),
  fingerprint bytea not null check (octet_length(fingerprint) = 32),
  order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (scope_hash, idempotency_key)
);

create table private.rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket_key, window_start)
);

create table private.webhook_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'rejected')),
  order_id uuid,
  note text,
  primary key (provider, event_id)
);

-- ---------------------------------------------------------------- inventory
-- Unknown stock is not zero and not unlimited: a variant is purchasable only when an admin has
-- confirmed the count (stock_verified).
create table public.inventory (
  variant_id uuid primary key references public.product_variants (id) on delete cascade,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  low_stock_threshold integer not null default 2 check (low_stock_threshold >= 0),
  stock_verified boolean not null default false,
  verified_at timestamptz,
  verified_by uuid,
  updated_at timestamptz not null default now(),
  check (reserved <= on_hand)
);

create or replace function private.create_inventory_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory (variant_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger product_variants_inventory after insert on public.product_variants for each row execute function private.create_inventory_row();

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  kind text not null check (kind in ('initial_count', 'adjustment', 'reserve', 'release', 'sale', 'cancel_restock', 'return_restock', 'commit_reservation')),
  delta_on_hand integer not null default 0,
  delta_reserved integer not null default 0,
  reason text not null default '' check (char_length(reason) <= 300),
  order_id uuid references public.orders (id) on delete set null,
  actor_id uuid,
  -- Idempotent operation identifier: replaying the same admin operation does nothing.
  op_key text unique,
  created_at timestamptz not null default now()
);
create index inventory_movements_variant_idx on public.inventory_movements (variant_id, created_at desc);

create or replace function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ov_error:append_only' using errcode = 'P0001';
end;
$$;
create trigger inventory_movements_immutable before update or delete on public.inventory_movements for each row execute function private.forbid_change();
create trigger order_events_immutable before update or delete on public.order_events for each row execute function private.forbid_change();

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active', 'committed', 'released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (order_id, variant_id)
);
create index stock_reservations_active_idx on public.stock_reservations (expires_at) where status = 'active';
create index stock_reservations_variant_idx on public.stock_reservations (variant_id) where status = 'active';

-- ---------------------------------------------------------------- returns and refunds (manual records)
create table public.order_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'received', 'closed')),
  reason text not null check (char_length(reason) between 1 and 500),
  admin_note text not null default '' check (char_length(admin_note) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index order_returns_order_idx on public.order_returns (order_id);

create table public.order_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.order_returns (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  quantity integer not null check (quantity between 1 and 99),
  restocked_at timestamptz,
  unique (return_id, order_item_id)
);

-- A refund RECORD is not a refund. status 'confirmed' means the money was actually returned
-- (by the provider, or by an explicit audited manual confirmation).
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  return_id uuid references public.order_returns (id) on delete set null,
  amount_pkr integer not null check (amount_pkr > 0),
  method text not null check (method in ('manual', 'provider')),
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'failed', 'cancelled')),
  provider text,
  provider_ref text,
  note text not null default '' check (char_length(note) <= 500),
  requested_by uuid,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index refunds_order_idx on public.refunds (order_id);

-- ---------------------------------------------------------------- support, newsletter, outbox, audit
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'contact' check (kind in ('contact', 'return_request')),
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null default '' check (char_length(last_name) <= 80),
  email text not null check (char_length(email) between 3 and 254),
  phone text not null default '' check (char_length(phone) <= 30),
  topics text[] not null default '{}' check (cardinality(topics) <= 8),
  order_number text check (order_number is null or char_length(order_number) <= 40),
  message text not null check (char_length(message) between 1 and 4000),
  status text not null default 'new' check (status in ('new', 'read', 'replied', 'spam', 'archived')),
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contact_messages_status_idx on public.contact_messages (status, created_at desc);

create table public.newsletter_subscriptions (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  consent_text text not null check (char_length(consent_text) between 1 and 500),
  consent_at timestamptz not null default now(),
  source text not null default 'footer' check (char_length(source) <= 40),
  unsubscribe_token_hash bytea not null check (octet_length(unsubscribe_token_hash) = 32),
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index newsletter_email_uidx on public.newsletter_subscriptions (lower(email));

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (char_length(kind) between 1 and 60),
  dedupe_key text not null unique,
  -- Minimal payload: ids and codes, never full addresses or raw request bodies.
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_outbox_due_idx on public.notification_outbox (next_attempt_at) where status in ('pending', 'failed');

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create trigger admin_audit_log_immutable before update or delete on public.admin_audit_log for each row execute function private.forbid_change();

create trigger orders_touch before update on public.orders for each row execute function private.touch_updated_at();
create trigger payment_attempts_touch before update on public.payment_attempts for each row execute function private.touch_updated_at();
create trigger order_returns_touch before update on public.order_returns for each row execute function private.touch_updated_at();
create trigger contact_messages_touch before update on public.contact_messages for each row execute function private.touch_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.order_notes enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.stock_reservations enable row level security;
alter table public.order_returns enable row level security;
alter table public.order_return_items enable row level security;
alter table public.refunds enable row level security;
alter table public.contact_messages enable row level security;
alter table public.newsletter_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.admin_audit_log enable row level security;
alter table private.order_access_tokens enable row level security;
alter table private.checkout_requests enable row level security;
alter table private.rate_limits enable row level security;
alter table private.webhook_events enable row level security;

-- ---------------------------------------------------------------- audit triggers for admin-editable tables
create or replace function private.audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  ent_id text;
  before_row jsonb;
  after_row jsonb;
begin
  -- System/service operations are not admin actions, except role membership changes, which are
  -- always recorded (made by the project owner with a server-side statement).
  if actor is null and tg_table_name <> 'admin_members' then
    return coalesce(new, old);
  end if;
  before_row := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  after_row := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  ent_id := coalesce(after_row ->> 'id', after_row ->> 'code', after_row ->> 'key', after_row ->> 'slug', before_row ->> 'id', before_row ->> 'code', before_row ->> 'key', before_row ->> 'slug', after_row ->> 'user_id', before_row ->> 'user_id');
  insert into public.admin_audit_log (actor_id, action, entity, entity_id, before_data, after_data)
  values (actor, lower(tg_op), tg_table_schema || '.' || tg_table_name, ent_id, before_row, after_row);
  return coalesce(new, old);
end;
$$;

create trigger audit_categories after insert or update or delete on public.categories for each row execute function private.audit_change();
create trigger audit_brands after insert or update or delete on public.brands for each row execute function private.audit_change();
create trigger audit_products after insert or update or delete on public.products for each row execute function private.audit_change();
create trigger audit_product_variants after insert or update or delete on public.product_variants for each row execute function private.audit_change();
create trigger audit_product_images after insert or update or delete on public.product_images for each row execute function private.audit_change();
create trigger audit_site_images after insert or update or delete on public.site_images for each row execute function private.audit_change();
create trigger audit_store_settings after insert or update or delete on public.store_settings for each row execute function private.audit_change();
create trigger audit_shipping_zones after insert or update or delete on public.shipping_zones for each row execute function private.audit_change();
create trigger audit_shipping_methods after insert or update or delete on public.shipping_methods for each row execute function private.audit_change();
create trigger audit_shipping_rates after insert or update or delete on public.shipping_rates for each row execute function private.audit_change();
create trigger audit_payment_methods after insert or update or delete on public.payment_methods for each row execute function private.audit_change();
create trigger audit_policy_pages after update on public.policy_pages for each row execute function private.audit_change();
create trigger audit_contact_messages after update on public.contact_messages for each row execute function private.audit_change();
create trigger audit_admin_members after insert or update or delete on private.admin_members for each row execute function private.audit_change();
