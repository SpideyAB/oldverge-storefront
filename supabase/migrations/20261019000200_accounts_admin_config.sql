-- Accounts, admin membership, store configuration, shipping, payment methods and policies.

-- ---------------------------------------------------------------- admin membership
-- Lives in the private schema: not reachable through the Data API. Rows are created only by
-- a deliberate server-side statement (see docs/supabase-setup.md), never by signup or profile edits.
create table private.admin_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  created_by text
);

create table private.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into private.settings (key, value) values
  ('require_mfa', 'false'::jsonb),             -- when true, admin access needs an aal2 (TOTP) session
  ('reservation_minutes', '30'::jsonb),        -- online-payment stock reservation window
  ('order_access_days', '90'::jsonb);          -- lifetime of a guest order access link

create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  mfa boolean;
begin
  if uid is null then return false; end if;
  if not exists (select 1 from private.admin_members m where m.user_id = uid) then return false; end if;
  select coalesce((s.value)::text::boolean, false) into mfa from private.settings s where s.key = 'require_mfa';
  if coalesce(mfa, false) and coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then return false; end if;
  return true;
end;
$$;

create or replace function public.admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_admin() then (select m.role from private.admin_members m where m.user_id = (select auth.uid())) end;
$$;

-- ---------------------------------------------------------------- customers
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  phone text not null default '' check (char_length(phone) <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null default 'Home' check (char_length(label) between 1 and 40),
  recipient text not null check (char_length(recipient) between 1 and 120),
  phone text not null check (char_length(phone) between 5 and 30),
  line1 text not null check (char_length(line1) between 1 and 200),
  line2 text not null default '' check (char_length(line2) <= 200),
  city text not null check (char_length(city) between 1 and 80),
  province text not null check (char_length(province) between 1 and 80),
  postal_code text not null default '' check (char_length(postal_code) <= 12),
  country text not null default 'PK' check (country = 'PK'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);
create unique index addresses_one_default_uidx on public.addresses (user_id) where is_default;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only a display name is read from signup metadata. Roles are never derived from user-editable data.
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), ''), 80))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create or replace function private.limit_addresses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.addresses a where a.user_id = new.user_id) >= 10 then
    raise exception 'ov_error:too_many_addresses' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger addresses_limit before insert on public.addresses for each row execute function private.limit_addresses();
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger addresses_touch before update on public.addresses for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- store settings
create table public.store_settings (
  key text primary key check (key ~ '^[a-z0-9_.]+$'),
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.store_settings (key, value, is_public) values
  ('ordering_enabled', 'false'::jsonb, true),
  ('max_quantity_per_line', '9'::jsonb, true),
  ('max_lines', '20'::jsonb, true),
  ('tax_mode', '"not_calculated"'::jsonb, true),
  ('contact.email', 'null'::jsonb, true),
  ('contact.phone', 'null'::jsonb, true),
  ('contact.whatsapp', 'null'::jsonb, true),
  ('contact.instagram', 'null'::jsonb, true),
  ('contact.address', 'null'::jsonb, true),
  ('notice.footer', '"Displayed prices are samples. Orders are not open yet."'::jsonb, true);
create trigger store_settings_touch before update on public.store_settings for each row execute function private.touch_updated_at();

-- ordering_enabled can only be changed through public.admin_set_ordering_enabled (readiness checks).
create or replace function private.guard_ordering_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key = 'ordering_enabled' and new.value is distinct from old.value
     and coalesce(current_setting('oldverge.ordering_toggle', true), '') <> 'on' then
    raise exception 'ov_error:use_admin_set_ordering_enabled' using errcode = 'P0001';
  end if;
  if old.key = 'ordering_enabled' and new.key <> old.key then
    raise exception 'ov_error:protected_setting' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger store_settings_guard before update on public.store_settings for each row execute function private.guard_ordering_setting();

create or replace function private.protect_setting_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.key = 'ordering_enabled' then
    raise exception 'ov_error:protected_setting' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and new.key = 'ordering_enabled' and exists (select 1 from public.store_settings where key = 'ordering_enabled') then
    raise exception 'ov_error:protected_setting' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger store_settings_protect before insert or delete on public.store_settings for each row execute function private.protect_setting_rows();

-- ---------------------------------------------------------------- shipping and payment (owner-approved only)
create table public.shipping_zones (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name text not null check (char_length(name) between 1 and 80),
  -- null means every province. Otherwise the shipping address province must be in this list.
  provinces text[],
  created_at timestamptz not null default now()
);

create table public.shipping_methods (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  label text not null check (char_length(label) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  estimate_text text not null default '' check (char_length(estimate_text) <= 120),
  enabled boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  method_code text not null references public.shipping_methods (code) on delete cascade,
  zone_code text not null references public.shipping_zones (code) on delete cascade,
  price_pkr integer not null check (price_pkr >= 0 and price_pkr <= 10000000),
  free_over_pkr integer check (free_over_pkr is null or free_over_pkr > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (method_code, zone_code)
);

create table public.payment_methods (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  label text not null check (char_length(label) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  kind text not null check (kind in ('cod', 'online')),
  provider text,
  enabled boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Cash on delivery exists as a disabled row only. It must be explicitly approved and enabled by the owner.
insert into public.payment_methods (code, label, description, kind, enabled) values
  ('cod', 'Cash on delivery', 'Pay the courier when the order arrives.', 'cod', false);
create trigger shipping_methods_touch before update on public.shipping_methods for each row execute function private.touch_updated_at();
create trigger payment_methods_touch before update on public.payment_methods for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- policies
-- Published text only. Drafts live in policy_drafts, which clients cannot read.
create table public.policy_pages (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 120),
  -- sections: [{ "heading": text, "body": [paragraph, ...] }]
  published_sections jsonb check (published_sections is null or jsonb_typeof(published_sections) = 'array'),
  version integer not null default 0,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create table public.policy_drafts (
  slug text primary key references public.policy_pages (slug) on delete cascade,
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.policy_pages (slug, title) values
  ('shipping', 'Shipping Policy'),
  ('refund-policy', 'Returns & Refunds'),
  ('privacy-policy', 'Privacy Policy'),
  ('terms-and-conditions', 'Terms & Conditions');
insert into public.policy_drafts (slug) select slug from public.policy_pages;
create trigger policy_drafts_touch before update on public.policy_drafts for each row execute function private.touch_updated_at();
create trigger policy_pages_touch before update on public.policy_pages for each row execute function private.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.addresses enable row level security;
alter table public.store_settings enable row level security;
alter table public.shipping_zones enable row level security;
alter table public.shipping_methods enable row level security;
alter table public.shipping_rates enable row level security;
alter table public.payment_methods enable row level security;
alter table public.policy_pages enable row level security;
alter table public.policy_drafts enable row level security;
alter table private.admin_members enable row level security;
alter table private.settings enable row level security;
