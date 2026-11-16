begin;

alter table public.forest_zones add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

drop trigger if exists guard_zone_deletion on public.forest_zones;
create trigger guard_zone_deletion before update or delete on public.forest_zones
  for each row execute function public.guard_directory_deletion();

create or replace function public.soft_delete_directory(p_kind text,p_target uuid,p_actor uuid,p_password_version text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles%rowtype; target_profile profiles%rowtype; target_station sensor_stations%rowtype; target_zone forest_zones%rowtype; blockers jsonb; stamp timestamptz := now();
begin
  -- Serialize deletions and role changes while checking the final administrator.
  lock table profiles in share row exclusive mode;
  select * into actor from profiles where id=p_actor;
  if not found or actor.deleted_at is not null or actor.role<>'super_admin' then
    raise exception using errcode='42501',message='ผู้ดูแลไม่มีสิทธิ์ดำเนินการ';
  end if;
  if actor.password_hash is null or md5(actor.password_hash) is distinct from p_password_version then
    raise exception using errcode='28000',message='รหัสผ่านเปลี่ยนแล้ว กรุณายืนยันใหม่';
  end if;
  if p_kind='profile' then
    if p_target=p_actor then raise exception using errcode='P0001',message='ไม่สามารถลบบัญชีตัวเองได้'; end if;
    select * into target_profile from profiles where id=p_target for update;
    if not found then raise exception using errcode='P0002',message='ไม่พบบัญชี'; end if;
    if target_profile.deleted_at is not null then return jsonb_build_object('alreadyDeleted',true); end if;
    if target_profile.role='super_admin' and (select count(*) from profiles where role='super_admin' and deleted_at is null)<=1 then
      raise exception using errcode='P0001',message='ไม่สามารถลบผู้ดูแลระบบคนสุดท้ายได้';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind)),'[]'::jsonb) into blockers from (
      select id,report_code as name,'report' as kind from reports where assigned_to=p_target and status not in ('closed','rejected')
      union all select id,name,'zone' from forest_zones where responsible_officer_id=p_target and deleted_at is null
    ) pending;
    if jsonb_array_length(blockers)>0 then return jsonb_build_object('blocked',true,'items',blockers); end if;
    update profiles set deleted_at=stamp,deleted_by=p_actor,updated_at=stamp where id=p_target;
  elsif p_kind='station' then
    select * into target_station from sensor_stations where id=p_target for update;
    if not found then raise exception using errcode='P0002',message='ไม่พบไมค์'; end if;
    if target_station.deleted_at is not null then return jsonb_build_object('alreadyDeleted',true); end if;
    update sensor_stations set deleted_at=stamp,deleted_by=p_actor,updated_at=stamp where id=p_target;
  elsif p_kind='zone' then
    select * into target_zone from forest_zones where id=p_target for update;
    if not found then raise exception using errcode='P0002',message='ไม่พบโซนป่า'; end if;
    if target_zone.deleted_at is not null then return jsonb_build_object('alreadyDeleted',true); end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',station_code || ' · ' || name,'kind','station') order by station_code),'[]'::jsonb)
      into blockers from sensor_stations where zone_id=p_target and deleted_at is null;
    if jsonb_array_length(blockers)>0 then return jsonb_build_object('blocked',true,'items',blockers); end if;
    update forest_zones set deleted_at=stamp,deleted_by=p_actor,updated_at=stamp where id=p_target;
  else raise exception using errcode='22023',message='ประเภทข้อมูลไม่ถูกต้อง'; end if;
  insert into audit_logs(actor_id,actor_name,action,target_table,target_id,details)
  values(p_actor,actor.full_name,'soft_delete',case p_kind when 'profile' then 'profiles' when 'station' then 'sensor_stations' else 'forest_zones' end,p_target,jsonb_build_object('deleted_at',stamp));
  return jsonb_build_object('deleted',true);
end $$;
revoke all on function public.soft_delete_directory(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.soft_delete_directory(text,uuid,uuid,text) to service_role;

-- Share the same row lock as deletion so a new reference cannot race it.
create or replace function public.check_active_zone_reference() returns trigger
language plpgsql set search_path=public as $$
declare zone_id_to_check uuid; removed timestamptz;
begin
  if tg_table_name='profiles' then
    for zone_id_to_check in
      select distinct selected.id from unnest(new.assigned_zone_ids) as selected(id)
      where tg_op='INSERT' or not coalesce(selected.id=any(old.assigned_zone_ids),false)
      order by selected.id
    loop
      select deleted_at into removed from forest_zones where id=zone_id_to_check for share;
      if not found or removed is not null then
        raise exception using errcode='23503',message='ไม่พบโซนที่ยังใช้งานอยู่';
      end if;
    end loop;
  elsif new.zone_id is not null and (tg_op='INSERT' or new.zone_id is distinct from old.zone_id) then
    select deleted_at into removed from forest_zones where id=new.zone_id for share;
    if removed is not null then raise exception using errcode='23503',message='โซนป่าถูกลบแล้ว'; end if;
  end if;
  return new;
end $$;

drop trigger if exists check_active_station_zone on public.sensor_stations;
create trigger check_active_station_zone before insert or update of zone_id on public.sensor_stations
  for each row execute function public.check_active_zone_reference();
drop trigger if exists check_active_report_zone on public.reports;
create trigger check_active_report_zone before insert or update of zone_id on public.reports
  for each row execute function public.check_active_zone_reference();
drop trigger if exists check_active_profile_zones on public.profiles;
create trigger check_active_profile_zones before insert or update of assigned_zone_ids on public.profiles
  for each row execute function public.check_active_zone_reference();

notify pgrst,'reload schema';
commit;
