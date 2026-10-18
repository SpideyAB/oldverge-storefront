-- Users that existed before the sign-up trigger get a profile row too (customers can update but not insert profiles).
insert into public.profiles (user_id, display_name)
select u.id, left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), ''), 80)
  from auth.users u
on conflict (user_id) do nothing;
