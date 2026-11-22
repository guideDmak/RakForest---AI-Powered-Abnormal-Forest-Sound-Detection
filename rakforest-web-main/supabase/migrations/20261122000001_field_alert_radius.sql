begin;

alter table public.notification_rules
  add column if not exists field_radius_meters integer not null default 1000
  check (field_radius_meters between 0 and 100000);

create or replace function public.field_alert_recipients(p_report_id uuid)
returns table (chat_id text)
language sql
stable
set search_path = pg_catalog, public, extensions
as $$
  with incident as (
    select r.zone_id, r.location, n.field_radius_meters
    from public.reports r
    join public.notification_rules n on n.risk_level = r.risk_level
    where r.id = p_report_id
      and r.risk_level in ('red', 'yellow')
      and 'telegram' = any(n.channels)
  ), zone_shapes as (
    select z.id,
      case when jsonb_array_length(z.polygon_coords) >= 3 then
        st_geomfromgeojson(jsonb_build_object(
          'type', 'Polygon',
          'coordinates', jsonb_build_array(
            case when z.polygon_coords->0 = z.polygon_coords->-1 then z.polygon_coords
                 else z.polygon_coords || jsonb_build_array(z.polygon_coords->0) end
          )
        ))
      else z.geometry end as shape
    from public.forest_zones z
    where z.deleted_at is null
  ), relevant_zones as (
    select z.id from zone_shapes z cross join incident i
    where z.id = i.zone_id
      or ((i.field_radius_meters > 0 or i.zone_id is null)
          and st_isvalid(z.shape)
          and st_dwithin(z.shape::geography, i.location, i.field_radius_meters))
  )
  select distinct btrim(p.telegram_chat_id) as chat_id
  from public.profiles p
  where p.role = 'field_ranger'
    and p.verification_status = 'approved'
    and p.deleted_at is null
    and btrim(p.telegram_chat_id) ~ '^-?[0-9]+$'
    and exists (select 1 from relevant_zones z where z.id = any(p.assigned_zone_ids));
$$;

revoke all on function public.field_alert_recipients(uuid) from public, anon, authenticated;
grant execute on function public.field_alert_recipients(uuid) to service_role;

commit;