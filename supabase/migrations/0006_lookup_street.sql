create or replace function public.lookup_zipcode_street(
  p_city text, p_district text, p_street text, p_sector text default ''
) returns table(zip_code text, city_name text, district_name text, street_name text, sector text, source_detail text)
language sql stable security definer set search_path = postal, pg_temp as $$
  select ps.zip_code, ps.city_name, ps.district_name, ps.street_name, ps.sector, ps.source_detail
  from postal.post_street ps
  where ps.city_name = p_city
    and ps.district_name = p_district
    and ps.street_name = p_street
    and (p_sector = '' or ps.sector = '0' or ps.sector = p_sector)
  order by ps.zip_code, ps.source_detail;
$$;

grant execute on function public.lookup_zipcode_street(text, text, text, text) to anon;
notify pgrst, 'reload schema';
