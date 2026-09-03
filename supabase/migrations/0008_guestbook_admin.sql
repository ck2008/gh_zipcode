-- Moderation is restricted to a single GitHub account.
--
-- The check reads auth.identities rather than the JWT's user_metadata:
-- raw_user_meta_data is writable by the user themselves through the Auth API,
-- so any signed-in GitHub user could set user_name = 'ck2008' and pass a
-- handle-based check.  provider_id is the immutable GitHub numeric id written
-- by the OAuth flow, and it survives a handle rename.
create or replace function guestbook.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from auth.identities i
    where i.user_id = auth.uid()
      and i.provider = 'github'
      and i.provider_id = '11531735'
  );
$$;
revoke all on function guestbook.is_admin() from public;

-- Admin reads see unapproved rows, so they raise instead of returning empty:
-- 42501 comes back from PostgREST as HTTP 403, which the page reports plainly
-- rather than looking like "no comments yet".
create or replace function public.guestbook_admin_list(p_limit integer default 100)
returns table(id bigint, author text, body text, is_approved boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not guestbook.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select c.id, c.author, c.body, c.is_approved, c.created_at
    from guestbook.comment c
    order by c.is_approved, c.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create or replace function public.guestbook_admin_set_approved(p_id bigint, p_approved boolean)
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not guestbook.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update guestbook.comment set is_approved = coalesce(p_approved, false) where id = p_id;
  if not found then
    return 'not_found';
  end if;
  return case when coalesce(p_approved, false) then 'approved' else 'unapproved' end;
end;
$$;

create or replace function public.guestbook_admin_delete(p_id bigint)
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not guestbook.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from guestbook.comment where id = p_id;
  if not found then
    return 'not_found';
  end if;
  return 'deleted';
end;
$$;

-- anon is deliberately not granted: these require a signed-in session, and the
-- is_admin() check then narrows that to the one account.
revoke all on function public.guestbook_admin_list(integer) from public;
revoke all on function public.guestbook_admin_set_approved(bigint, boolean) from public;
revoke all on function public.guestbook_admin_delete(bigint) from public;
grant execute on function public.guestbook_admin_list(integer) to authenticated;
grant execute on function public.guestbook_admin_set_approved(bigint, boolean) to authenticated;
grant execute on function public.guestbook_admin_delete(bigint) to authenticated;
notify pgrst, 'reload schema';
