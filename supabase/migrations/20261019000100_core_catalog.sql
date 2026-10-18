-- OLDVERGE core catalogue: categories, brands, products, variants, images.
-- Money is whole PKR in integer columns (never floats). Every table has RLS enabled in the
-- policies migration; grants are managed explicitly (nothing is granted by default).

create schema if not exists private;
comment on schema private is 'Not exposed through the Data API. Holds guest-access hashes, idempotency records, rate limits and webhook records.';
revoke all on schema private from public;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  parent_id uuid references public.categories (id) on delete restrict,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  legacy_id text unique,
  name text not null check (char_length(name) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  category_id uuid not null references public.categories (id) on delete restrict,
  brand_id uuid references public.brands (id) on delete restrict,
  kind text not null check (kind in ('watch', 'clothing')),
  style text check (style is null or char_length(style) <= 60),
  -- Products that are colour siblings of each other share a group_key (the existing colour-swatch routes).
  group_key text check (group_key is null or group_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- Owner has verified price, stock and photo for real selling. Browsing and buying are separate gates.
  ready_to_sell boolean not null default false,
  sort_order integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not ready_to_sell or status = 'published')
);
create index products_status_idx on public.products (status, sort_order);
create index products_category_idx on public.products (category_id);
create index products_brand_idx on public.products (brand_id);
create index products_group_idx on public.products (group_key) where group_key is not null;

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  sku text not null unique check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$'),
  color_name text check (color_name is null or char_length(color_name) between 1 and 40),
  color_hex text check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  size_label text check (size_label is null or char_length(size_label) between 1 and 20),
  price_pkr integer not null check (price_pkr >= 0 and price_pkr <= 100000000),
  currency text not null default 'PKR' check (currency = 'PKR'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One variant per option combination, including the case where an option is null.
create unique index product_variants_option_uidx
  on public.product_variants (product_id, coalesce(color_name, ''), coalesce(size_label, ''));
create index product_variants_product_idx on public.product_variants (product_id, sort_order);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete set null,
  bucket text not null check (bucket in ('product-public', 'product-private')),
  path text not null check (char_length(path) between 3 and 300 and path !~ '\.\.' and path !~ '^/'),
  kind text not null default 'photo' check (kind in ('photo', 'cutout')),
  alt_text text not null default '' check (char_length(alt_text) <= 200),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  source_name text,
  source_url text,
  licence text,
  attribution text,
  retrieved_on date,
  approval_status text not null default 'unverified' check (approval_status in ('unverified', 'approved', 'rejected')),
  approved_by uuid,
  approved_at timestamptz,
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, path),
  -- Only approved images may live in the public bucket (a public bucket cannot hide drafts).
  check (bucket <> 'product-public' or approval_status = 'approved')
);
create unique index product_images_one_cover_uidx on public.product_images (product_id) where is_cover;
create index product_images_product_idx on public.product_images (product_id, sort_order);

-- Editorial and site images (hero, category tiles, story). Same approval rules as product images.
create table public.site_images (
  key text primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  bucket text not null check (bucket in ('product-public', 'product-private')),
  path text not null check (char_length(path) between 3 and 300 and path !~ '\.\.' and path !~ '^/'),
  alt_text text not null default '' check (char_length(alt_text) <= 200),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  source_name text,
  source_url text,
  licence text,
  approval_status text not null default 'unverified' check (approval_status in ('unverified', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (bucket <> 'product-public' or approval_status = 'approved')
);

create trigger categories_touch before update on public.categories for each row execute function private.touch_updated_at();
create trigger brands_touch before update on public.brands for each row execute function private.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function private.touch_updated_at();
create trigger product_variants_touch before update on public.product_variants for each row execute function private.touch_updated_at();
create trigger product_images_touch before update on public.product_images for each row execute function private.touch_updated_at();
create trigger site_images_touch before update on public.site_images for each row execute function private.touch_updated_at();

alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.site_images enable row level security;
