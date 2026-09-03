-- Supabase Data API exposes the public schema by default. Keep raw data in
-- postal, while this public wrapper is the only anon-callable endpoint.
create or replace function public.lookup_zipcode_33(
  p_city text, p_district text, p_street text, p_sector text,
  p_neighborhood integer, p_lane text, p_alley integer,
  p_house_number integer, p_house_number_sub integer,
  p_number_type integer, p_record_type integer, p_floor integer
) returns table(zip_code text, city_name text, district_name text, street_name text, sector text, source_detail text)
language sql stable security definer set search_path = postal, pg_temp as $$
  select * from postal.lookup_zipcode_33(
    p_city, p_district, p_street, p_sector, p_neighborhood, p_lane, p_alley,
    p_house_number, p_house_number_sub, p_number_type, p_record_type, p_floor
  );
$$;
revoke all on function public.lookup_zipcode_33(text,text,text,text,integer,integer,integer,integer,integer,integer,integer,integer) from public;
grant execute on function public.lookup_zipcode_33(text,text,text,text,integer,text,integer,integer,integer,integer,integer,integer) to anon;
