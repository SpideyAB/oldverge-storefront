-- Image approval can only happen through admin_approve_image / admin_reject_image (which require provenance and,
-- via the Edge Function, a verified copy in the public bucket). Direct table writes by an API user may not approve
-- an image, move it to the public bucket or set approval metadata. System/owner SQL (no JWT) is unaffected.

create or replace function private.guard_image_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or coalesce(current_setting('oldverge.image_action', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.approval_status <> 'unverified' or new.bucket <> 'product-private' or new.approved_by is not null or new.approved_at is not null then
      perform private.fail('image_approval_via_function_only');
    end if;
  elsif new.approval_status is distinct from old.approval_status or new.bucket is distinct from old.bucket
     or new.path is distinct from old.path or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    perform private.fail('image_approval_via_function_only');
  end if;
  return new;
end;
$$;
create trigger product_images_guard before insert or update on public.product_images for each row execute function private.guard_image_state();

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
  if exists (select 1 from public.product_images im where im.id = p_image_id and (coalesce(btrim(im.source_name), '') = '' or coalesce(btrim(im.licence), '') = '')) then
    perform private.fail('provenance_required');
  end if;
  perform set_config('oldverge.image_action', 'on', true);
  update public.product_images
     set bucket = 'product-public', path = p_public_path, approval_status = 'approved', approved_by = actor, approved_at = now()
   where id = p_image_id;
  perform set_config('oldverge.image_action', 'off', true);
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
  perform set_config('oldverge.image_action', 'on', true);
  update public.product_images set approval_status = 'rejected', is_cover = false where id = p_image_id and bucket = 'product-private';
  perform set_config('oldverge.image_action', 'off', true);
  if not found then
    perform private.fail('not_found');
  end if;
  perform private.audit_action(actor, 'reject', 'public.product_images', p_image_id::text);
end;
$$;

-- Atomic cover change: only an approved image of the same product can be the cover.
create or replace function public.admin_set_cover_image(p_image_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  im public.product_images;
begin
  select * into im from public.product_images where id = p_image_id for update;
  if not found then perform private.fail('not_found'); end if;
  if im.approval_status <> 'approved' then perform private.fail('image_not_approved'); end if;
  update public.product_images set is_cover = false where product_id = im.product_id and is_cover and id <> im.id;
  update public.product_images set is_cover = true where id = im.id;
  perform private.audit_action(actor, 'set_cover', 'public.product_images', p_image_id::text);
end;
$$;

-- Friendly validation instead of a raw check-constraint error.
create or replace function public.admin_add_order_note(p_order_id uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_admin();
  note text := btrim(coalesce(p_note, ''));
begin
  if char_length(note) not between 1 and 2000 then
    perform private.fail('invalid_request');
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    perform private.fail('not_found');
  end if;
  insert into public.order_notes (order_id, author_id, note) values (p_order_id, actor, note);
end;
$$;

revoke all on function public.admin_set_cover_image(uuid) from public, anon, authenticated;
grant execute on function public.admin_set_cover_image(uuid) to authenticated;

revoke all on function private.guard_image_state() from public, anon, authenticated;
