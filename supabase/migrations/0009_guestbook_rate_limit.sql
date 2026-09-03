-- Rate limiting for the anon guestbook endpoints.
--
-- PostgREST exposes the HTTP request headers to SQL, so the limiter can live
-- next to the functions it guards rather than needing an Edge Function in
-- front the way public/zipcode does.  Verified that x-forwarded-for arrives
-- populated; if it ever stops, client_key() falls back to 'unknown' and every
-- caller shares one bucket, which throttles everyone -- so the fallback is
-- deliberately conservative rather than fail-open.
create or replace function guestbook.client_key()
returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    nullif(btrim(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1)), ''),
    'unknown');
$$;

create table if not exists guestbook.rate_hit (
  bucket text not null,
  client text not null,
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (bucket, client, window_start)
);
alter table guestbook.rate_hit enable row level security;
revoke all on guestbook.rate_hit from anon, authenticated;

-- Fixed one-minute windows.  A caller can burst across a window boundary,
-- which is an acceptable trade for a counter this cheap.
create or replace function guestbook.take_token(p_bucket text, p_limit integer)
returns boolean language plpgsql volatile set search_path = public, pg_temp as $$
declare
  v_hits integer;
begin
  delete from guestbook.rate_hit where window_start < now() - interval '10 minutes';
  insert into guestbook.rate_hit as r (bucket, client, window_start)
  values (p_bucket, guestbook.client_key(), date_trunc('minute', now()))
  on conflict (bucket, client, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- 20/min: a human reloading the challenge a few times stays well clear.
create or replace function public.guestbook_new_captcha()
returns table(token uuid, svg text)
language plpgsql volatile security definer set search_path = guestbook, pg_temp as $$
declare
  v_code text := guestbook.random_code(5);
  v_token uuid;
begin
  if not guestbook.take_token('captcha', 20) then
    raise exception '驗證碼要求過於頻繁，請稍後再試。';
  end if;
  delete from guestbook.captcha where expires_at < now() - interval '1 hour';
  insert into guestbook.captcha (answer) values (v_code) returning captcha.token into v_token;
  return query select v_token, guestbook.captcha_svg(v_code);
end;
$$;

-- 10/min, checked before validation so failed attempts count too.  Each wrong
-- captcha burns one, so the ceiling has to leave room for honest mistakes.
create or replace function public.guestbook_post_comment(
  p_token uuid, p_answer text, p_author text, p_body text
) returns text
language plpgsql volatile security definer set search_path = guestbook, pg_temp as $$
declare
  v_answer text;
begin
  if not guestbook.take_token('post', 10) then
    return 'rate_limited';
  end if;
  if coalesce(btrim(p_author), '') = '' or coalesce(btrim(p_body), '') = '' then
    return 'empty';
  end if;
  if length(btrim(p_author)) > 40 or length(btrim(p_body)) > 1000 then
    return 'too_long';
  end if;
  update guestbook.captcha set consumed_at = now()
  where token = p_token and consumed_at is null and expires_at > now()
  returning answer into v_answer;
  if v_answer is null then
    return 'captcha_expired';
  end if;
  if upper(btrim(p_answer)) <> v_answer then
    return 'captcha_wrong';
  end if;
  insert into guestbook.comment (author, body) values (btrim(p_author), btrim(p_body));
  return 'pending';
end;
$$;

-- guestbook_list_comments is left unlimited on purpose: it is a cheap read of
-- already-public rows and creates nothing.

drop function if exists public.guestbook_probe_ip();
notify pgrst, 'reload schema';
