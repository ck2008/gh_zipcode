-- Call log for the public zipcode API.
--
-- Rows are written by the Edge Function with the service role, so the table
-- lives in its own schema and neither anon nor authenticated can touch it
-- directly -- reads go through the admin wrapper below, gated by the same
-- guestbook.is_admin() used by the moderation page.
--
-- The caller IP is personal data.  It is kept because the point of the log is
-- spotting who is hammering the endpoint, but rows are pruned after 30 days.
create schema if not exists apilog;

create table if not exists apilog.call (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ip text,
  adrs text,
  status integer not null,
  zipcode6 text,
  result_count integer not null default 0,
  duration_ms integer,
  user_agent text
);
create index if not exists call_at_idx on apilog.call (at desc);
alter table apilog.call enable row level security;
revoke all on apilog.call from anon, authenticated;

-- Pruning runs on roughly 1% of writes rather than every one: this is a log,
-- not a queue, so a little slack in the retention window costs nothing.
create or replace function public.api_log_write(
  p_ip text, p_adrs text, p_status integer, p_zipcode6 text,
  p_result_count integer, p_duration_ms integer, p_user_agent text
) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  insert into apilog.call (ip, adrs, status, zipcode6, result_count, duration_ms, user_agent)
  values (left(coalesce(p_ip, ''), 60), left(coalesce(p_adrs, ''), 200), p_status,
          left(coalesce(p_zipcode6, ''), 12), coalesce(p_result_count, 0), p_duration_ms,
          left(coalesce(p_user_agent, ''), 200));
  if random() < 0.01 then
    delete from apilog.call where at < now() - interval '30 days';
  end if;
end;
$$;
revoke all on function public.api_log_write(text, text, integer, text, integer, integer, text) from public;
grant execute on function public.api_log_write(text, text, integer, text, integer, integer, text) to service_role;

create or replace function public.admin_api_log(p_limit integer default 100)
returns table(at timestamptz, ip text, adrs text, status integer, zipcode6 text,
              result_count integer, duration_ms integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not guestbook.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select c.at, c.ip, c.adrs, c.status, c.zipcode6, c.result_count, c.duration_ms
    from apilog.call c
    order by c.at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create or replace function public.admin_api_stats()
returns table(bucket text, calls bigint, ips bigint, errors bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not guestbook.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select w.label,
           count(c.id),
           count(distinct c.ip),
           count(c.id) filter (where c.status >= 400)
    from (values ('24 小時', interval '1 day'), ('7 天', interval '7 days'),
                 ('30 天', interval '30 days')) as w(label, span)
    left join apilog.call c on c.at >= now() - w.span
    group by w.label, w.span
    order by w.span;
end;
$$;

revoke all on function public.admin_api_log(integer) from public;
revoke all on function public.admin_api_stats() from public;
grant execute on function public.admin_api_log(integer) to authenticated;
grant execute on function public.admin_api_stats() to authenticated;
notify pgrst, 'reload schema';
