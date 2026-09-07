-- Global ceiling for the address lookup, shared by the public API and the LINE
-- bot.
--
-- The Edge Function already caps 30/min per caller IP (20 per LINE sender),
-- but that counter sits in one instance's memory: Supabase runs several
-- instances, and a caller spread over many IPs is never counted twice against
-- the same bucket.  This is the limit that actually bounds concurrent load --
-- a single row per minute for the whole project, so every request serialises
-- on it and the count cannot drift.
--
-- Only service_role gets execute, so the ceiling cannot be lifted by passing a
-- bigger p_limit from the browser: the anon key has no grant here at all.
create table if not exists apilog.rate_hit (
  window_start timestamptz primary key,
  hits integer not null default 1
);
alter table apilog.rate_hit enable row level security;
revoke all on apilog.rate_hit from anon, authenticated;

-- Fixed one-minute windows, the same trade as guestbook.take_token(): a burst
-- straddling a boundary can briefly see twice the limit.  That is fine for a
-- ceiling meant to stop sustained load rather than to meter precisely.
--
-- Pruning runs on roughly 1% of calls; one row per minute is nothing to store,
-- so there is no point paying for a delete on every request.
create or replace function public.api_take_token(p_limit integer)
returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_hits integer;
begin
  insert into apilog.rate_hit as r (window_start)
  values (date_trunc('minute', now()))
  on conflict (window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if random() < 0.01 then
    delete from apilog.rate_hit where window_start < now() - interval '1 hour';
  end if;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.api_take_token(integer) from public;
grant execute on function public.api_take_token(integer) to service_role;
notify pgrst, 'reload schema';
