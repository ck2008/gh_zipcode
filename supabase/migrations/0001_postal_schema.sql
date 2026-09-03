create schema if not exists postal;

create table if not exists postal.post_street (
  legacy_id bigint primary key,
  zip_code text not null check (zip_code ~ '^\\d{6}$'),
  district_id integer,
  city_name text,
  district_name text,
  street_name text,
  sector text,
  neighborhood integer,
  neighborhood_from integer,
  neighborhood_end integer,
  lane integer,
  lane_from integer,
  lane_end integer,
  alley integer,
  alley_from integer,
  alley_end integer,
  house_number integer,
  house_number_sub integer,
  floor integer,
  floor_from integer,
  house_number_from integer,
  house_number_from_sub integer,
  house_number_end integer,
  house_number_end_sub integer,
  floor_end integer,
  scope integer,
  number_type integer,
  record_type integer,
  source_detail text,
  source_version text,
  imported_at timestamptz not null default now()
);
create index if not exists post_street_lookup_idx on postal.post_street (city_name,district_name,street_name,sector);
alter table postal.post_street enable row level security;
revoke all on postal.post_street from anon, authenticated;
