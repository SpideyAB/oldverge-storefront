-- Fixes from the independent security review (2026-10-18). Additive: replaces functions and policies only.

-- 1. Protected private settings cannot be overridden by an admin-editable public.store_settings row.
create or replace function private.get_setting(p_key text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select s.value from private.settings s where s.key = p_key),
    (select s.value from public.store_settings s where s.key = p_key)
  );
$$;

-- 2. Approve/reject report not_found correctly (PERFORM resets FOUND, so use ROW_COUNT), and approval requires
--    that the validated copy already exists in the public bucket (only the service role can write there now).
create or replace function public.admin_approve_image(p_image_id uuid, p_public_path text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  n integer;
begin
  if p_public_path is null or char_length(p_public_path) not between 3 and 300 or p_public_path ~ '\.\.' or p_public_path ~ '^/' then
    perform private.fail('invalid_request');
  end if;
  if exists (select 1 from public.product_images im where im.id = p_image_id and (coalesce(btrim(im.source_name), '') = '' or coalesce(btrim(im.licence), '') = '')) then
    perform private.fail('provenance_required');
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'product-public' and o.name = p_public_path) then
    perform private.fail('public_copy_missing');
  end if;
  perform set_config('oldverge.image_action', 'on', true);
  update public.product_images
     set bucket = 'product-public', path = p_public_path, approval_status = 'approved', approved_by = actor, approved_at = now()
   where id = p_image_id and bucket = 'product-private';
  get diagnostics n = row_count;
  perform set_config('oldverge.image_action', 'off', true);
  if n = 0 then
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
  n integer;
begin
  perform set_config('oldverge.image_action', 'on', true);
  update public.product_images set approval_status = 'rejected', is_cover = false where id = p_image_id and bucket = 'product-private';
  get diagnostics n = row_count;
  perform set_config('oldverge.image_action', 'off', true);
  if n = 0 then
    perform private.fail('not_found');
  end if;
  perform private.audit_action(actor, 'reject', 'public.product_images', p_image_id::text);
end;
$$;

-- 3. Public bucket: no client writes (the admin-approve-image Edge Function copies validated bytes with the
--    service role) and no listing (public object URLs keep working without a SELECT policy).
drop policy if exists "product-public read" on storage.objects;
drop policy if exists "product-public admin insert" on storage.objects;
drop policy if exists "product-public admin update" on storage.objects;
drop policy if exists "product-public admin delete" on storage.objects;

-- 4. site_images: API users may only add unverified private rows and may not change approval, bucket or path.
--    Approving a site image is an owner SQL / migration-script step (no JWT), recorded in the audit log.
create or replace function private.guard_site_image_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.approval_status <> 'unverified' or new.bucket <> 'product-private' then
      perform private.fail('image_approval_via_function_only');
    end if;
  elsif new.approval_status is distinct from old.approval_status or new.bucket is distinct from old.bucket or new.path is distinct from old.path then
    perform private.fail('image_approval_via_function_only');
  end if;
  return new;
end;
$$;
revoke all on function private.guard_site_image_state() from public;
create trigger site_images_guard before insert or update on public.site_images for each row execute function private.guard_site_image_state();
