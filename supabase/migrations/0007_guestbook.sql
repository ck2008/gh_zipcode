-- Guestbook keeps its rows in their own schema so anon can only ever reach
-- them through the public wrappers below, the same way postal.post_street is
-- fronted by public.lookup_zipcode_33.
create schema if not exists guestbook;

create table if not exists guestbook.comment (
  id bigint generated always as identity primary key,
  author text not null,
  body text not null,
  is_approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comment_approved_idx on guestbook.comment (is_approved, created_at desc);
alter table guestbook.comment enable row level security;
revoke all on guestbook.comment from anon, authenticated;

-- One row per issued challenge.  The answer never leaves the server: the
-- client only ever sees the rendered SVG and the opaque token.
create table if not exists guestbook.captcha (
  token uuid primary key default gen_random_uuid(),
  answer text not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz
);
alter table guestbook.captcha enable row level security;
revoke all on guestbook.captcha from anon, authenticated;

create or replace function guestbook.random_code(p_length integer default 5)
returns text language sql volatile as $$
  select string_agg(substr('23456789', 1 + floor(random() * 8)::integer, 1), '')
  from generate_series(1, p_length);
$$;

-- Stroke outlines on a 10x14 grid.  The glyphs are drawn as <path> coordinates
-- rather than <text> so the answer is not sitting in the markup for a script to
-- read back -- that is the whole point of the challenge.  Digits only, because
-- eight hand-checked glyphs beat a full alphabet of shaky ones.
create or replace function guestbook.digit_path(p_digit text)
returns text language sql immutable as $$
  select case p_digit
    when '2' then 'M0,3 L3,0 L7,0 L10,4 L0,14 L10,14'
    when '3' then 'M0,1 L3,0 L7,0 L10,3 L6,6 L10,10 L7,14 L3,14 L0,13'
    when '4' then 'M7,14 L7,0 L0,9 L10,9'
    when '5' then 'M10,0 L2,0 L1,6 L6,6 L10,9 L7,14 L2,14 L0,13'
    when '6' then 'M9,1 L4,0 L0,7 L0,11 L3,14 L7,14 L10,11 L7,7 L2,7 L0,10'
    when '7' then 'M0,0 L10,0 L4,14'
    when '8' then 'M3,0 L7,0 L10,3 L6,7 L3,7 L0,3 L3,0 M6,7 L10,10 L7,14 L3,14 L0,10 L3,7'
    when '9' then 'M1,13 L6,14 L10,7 L10,3 L7,0 L3,0 L0,3 L3,7 L8,7 L10,4'
  end;
$$;

create or replace function guestbook.captcha_svg(p_code text)
returns text language plpgsql volatile as $$
declare
  parts text := '<rect width="170" height="54" fill="#f1f3f5"/>';
  i integer;
begin
  for i in 1..7 loop
    parts := parts || format(
      '<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="#adb5bd" stroke-width="1"/>',
      round(random() * 170), round(random() * 54), round(random() * 170), round(random() * 54));
  end loop;
  for i in 1..length(p_code) loop
    parts := parts || format(
      '<path d="%s" fill="none" stroke="#1c3d5a" stroke-width="2" stroke-linecap="round" transform="translate(%s %s) rotate(%s 8 12) scale(1.7)"/>',
      guestbook.digit_path(substr(p_code, i, 1)),
      8 + (i - 1) * 31 + round(random() * 5),
      6 + round(random() * 6),
      round((random() * 30) - 15));
  end loop;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="170" height="54" viewBox="0 0 170 54" role="img" aria-label="圖形驗證碼">'
    || parts || '</svg>';
end;
$$;

create or replace function public.guestbook_new_captcha()
returns table(token uuid, svg text)
language plpgsql volatile security definer set search_path = guestbook, pg_temp as $$
declare
  v_code text := guestbook.random_code(5);
  v_token uuid;
begin
  delete from guestbook.captcha where expires_at < now() - interval '1 hour';
  insert into guestbook.captcha (answer) values (v_code) returning captcha.token into v_token;
  return query select v_token, guestbook.captcha_svg(v_code);
end;
$$;

-- Returns a status string rather than raising, so the page can show a specific
-- message without parsing Postgres errors.  The token is consumed even on a
-- wrong answer, which caps each challenge at a single guess.
create or replace function public.guestbook_post_comment(
  p_token uuid, p_answer text, p_author text, p_body text
) returns text
language plpgsql volatile security definer set search_path = guestbook, pg_temp as $$
declare
  v_answer text;
begin
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

create or replace function public.guestbook_list_comments(p_limit integer default 50)
returns table(id bigint, author text, body text, created_at timestamptz)
language sql stable security definer set search_path = guestbook, pg_temp as $$
  select c.id, c.author, c.body, c.created_at
  from guestbook.comment c
  where c.is_approved
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.guestbook_new_captcha() from public;
revoke all on function public.guestbook_post_comment(uuid, text, text, text) from public;
revoke all on function public.guestbook_list_comments(integer) from public;
grant execute on function public.guestbook_new_captcha() to anon;
grant execute on function public.guestbook_post_comment(uuid, text, text, text) to anon;
grant execute on function public.guestbook_list_comments(integer) to anon;
notify pgrst, 'reload schema';
