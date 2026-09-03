-- SQL Server stores post_street.lane as varchar: named lanes such as「厚生巷」are valid.
-- This migration also replaces the RPC signatures so the browser can send text lanes.
drop function if exists public.lookup_zipcode_33(text,text,text,text,integer,integer,integer,integer,integer,integer,integer,integer);
drop function if exists postal.lookup_zipcode_33(text,text,text,text,integer,integer,integer,integer,integer,integer,integer,integer);

alter table postal.post_street alter column lane type text using lane::text;

create function postal.lookup_zipcode_33(
  p_city text, p_district text, p_street text, p_sector text,
  p_neighborhood integer, p_lane text, p_alley integer,
  p_house_number integer, p_house_number_sub integer,
  p_number_type integer, p_record_type integer, p_floor integer
) returns table(zip_code text, city_name text, district_name text, street_name text, sector text, source_detail text)
language sql stable security definer set search_path = postal, pg_temp as $$
  select ps.zip_code, ps.city_name, ps.district_name, ps.street_name, ps.sector, ps.source_detail
  from postal.post_street ps
  where
    (p_floor = -1 or p_floor = ps.floor or p_floor between ps.floor_from and ps.floor_end)
    and ((p_alley <> -1 and ps.record_type = p_record_type + 3 and ps.scope = 1 and (ps.number_type = 0 or ps.number_type = p_number_type)) or (p_lane <> '-1' and ps.record_type = p_record_type + 2 and ps.scope = 1 and (ps.number_type = 0 or ps.number_type = p_number_type)) or p_house_number = -1 or (p_house_number = ps.house_number and (p_house_number_sub = -1 or ps.house_number_sub = p_house_number_sub or p_house_number_sub between ps.house_number_from_sub and ps.house_number_end_sub)) or (p_house_number between ps.house_number_from and ps.house_number_end and (ps.number_type = 0 or (ps.number_type = p_number_type and ps.record_type = p_record_type))))
    and (p_city = '' or ps.city_name = p_city) and (p_district = '' or ps.district_name = p_district) and (p_street = '' or ps.street_name = p_street) and (p_sector = '' or ps.sector = '0' or ps.sector = p_sector)
    and (p_neighborhood = -1 or p_neighborhood = ps.neighborhood or (p_neighborhood between ps.neighborhood_from and ps.neighborhood_end and (ps.number_type = 0 or (ps.number_type = p_number_type and ps.record_type = p_record_type))))
    and (p_lane = '-1' or p_lane = ps.lane or (p_lane ~ '^[0-9]+$' and p_lane::integer between ps.lane_from and ps.lane_end and (ps.number_type = 0 or (ps.number_type = p_number_type and ps.record_type = p_record_type))))
    and ((p_lane <> '-1' and ps.record_type = p_record_type - 1 and ps.scope = 1 and (ps.number_type = 0 or ps.number_type = p_number_type)) or p_alley = -1 or p_alley = ps.alley or (p_alley between ps.alley_from and ps.alley_end and (ps.number_type = 0 or (ps.number_type = p_number_type and ps.record_type = p_record_type))))
  order by ps.zip_code;
$$;

revoke all on function postal.lookup_zipcode_33(text,text,text,text,integer,text,integer,integer,integer,integer,integer,integer) from public;

create function public.lookup_zipcode_33(
  p_city text, p_district text, p_street text, p_sector text,
  p_neighborhood integer, p_lane text, p_alley integer,
  p_house_number integer, p_house_number_sub integer,
  p_number_type integer, p_record_type integer, p_floor integer
) returns table(zip_code text, city_name text, district_name text, street_name text, sector text, source_detail text)
language sql stable security definer set search_path = postal, pg_temp as $$
  select * from postal.lookup_zipcode_33(p_city, p_district, p_street, p_sector, p_neighborhood, p_lane, p_alley, p_house_number, p_house_number_sub, p_number_type, p_record_type, p_floor);
$$;

grant execute on function public.lookup_zipcode_33(text,text,text,text,integer,text,integer,integer,integer,integer,integer,integer) to anon;
