begin;
alter table public.profiles add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);
alter table public.sensor_stations add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);
create sequence if not exists public.employee_code_seq;
select setval('public.employee_code_seq', greatest(
  (select last_value + case when is_called then 1 else 0 end from public.employee_code_seq),
  coalesce((select max(substring(employee_code from '^RF-EMP-([0-9]+)$')::bigint)+1 from public.profiles where employee_code ~ '^RF-EMP-[0-9]+$'),1)
), false);
create or replace function public.reserve_employee_code() returns text
language plpgsql security definer set search_path=public as $$
declare candidate text;
begin
  loop
    candidate := 'RF-EMP-' || lpad(nextval('public.employee_code_seq')::text, greatest(4,length(currval('public.employee_code_seq')::text)), '0');
    exit when not exists(select 1 from profiles where upper(employee_code)=candidate);
  end loop;
  return candidate;
end $$;
revoke all on sequence public.employee_code_seq from public, anon, authenticated;
revoke all on function public.reserve_employee_code() from public;
grant execute on function public.reserve_employee_code() to anon, authenticated, service_role;

create or replace function public.soft_delete_directory(p_kind text,p_target uuid,p_actor uuid,p_password_version text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor profiles%rowtype; target_profile profiles%rowtype; target_station sensor_stations%rowtype; blockers jsonb; stamp timestamptz := now();
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
      union all select id,name,'zone' from forest_zones where responsible_officer_id=p_target
    ) pending;
    if jsonb_array_length(blockers)>0 then return jsonb_build_object('blocked',true,'items',blockers); end if;
    update profiles set deleted_at=stamp,deleted_by=p_actor,updated_at=stamp where id=p_target;
  elsif p_kind='station' then
    select * into target_station from sensor_stations where id=p_target for update;
    if not found then raise exception using errcode='P0002',message='ไม่พบไมค์'; end if;
    if target_station.deleted_at is not null then return jsonb_build_object('alreadyDeleted',true); end if;
    update sensor_stations set deleted_at=stamp,deleted_by=p_actor,updated_at=stamp where id=p_target;
  else raise exception using errcode='22023',message='ประเภทข้อมูลไม่ถูกต้อง'; end if;
  insert into audit_logs(actor_id,actor_name,action,target_table,target_id,details)
  values(p_actor,actor.full_name,'soft_delete',case when p_kind='profile' then 'profiles' else 'sensor_stations' end,p_target,jsonb_build_object('deleted_at',stamp));
  return jsonb_build_object('deleted',true);
end $$;
revoke all on function public.soft_delete_directory(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.soft_delete_directory(text,uuid,uuid,text) to service_role;

create or replace function public.check_active_directory_reference() returns trigger
language plpgsql set search_path=public as $$
declare removed timestamptz;
begin
  if tg_table_name='reports' then
    if new.assigned_to is not null and (tg_op='INSERT' or new.assigned_to is distinct from old.assigned_to) then
      select deleted_at into removed from profiles where id=new.assigned_to for share;
      if removed is not null then raise exception using errcode='23503',message='เจ้าหน้าที่ถูกลบแล้ว'; end if;
    end if;
    if new.reporter_id is not null and tg_op='INSERT' then
      select deleted_at into removed from profiles where id=new.reporter_id for share;
      if removed is not null then raise exception using errcode='23503',message='เจ้าหน้าที่ถูกลบแล้ว'; end if;
    end if;
    if new.station_id is not null and (tg_op='INSERT' or new.station_id is distinct from old.station_id) then
      select deleted_at into removed from sensor_stations where id=new.station_id for share;
      if removed is not null then raise exception using errcode='23503',message='ไมค์ถูกลบแล้ว'; end if;
    end if;
  elsif tg_table_name='forest_zones' then
    if new.responsible_officer_id is not null and (tg_op='INSERT' or new.responsible_officer_id is distinct from old.responsible_officer_id) then
      select deleted_at into removed from profiles where id=new.responsible_officer_id for share;
      if removed is not null then raise exception using errcode='23503',message='เจ้าหน้าที่ถูกลบแล้ว'; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists check_active_report_references on public.reports;
create trigger check_active_report_references before insert or update on public.reports for each row execute function public.check_active_directory_reference();
drop trigger if exists check_active_zone_officer on public.forest_zones;
create trigger check_active_zone_officer before insert or update on public.forest_zones for each row execute function public.check_active_directory_reference();
create or replace function public.guard_directory_deletion() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then
    if current_user not in ('postgres','supabase_admin') then raise exception using errcode='42501',message='ใช้การลบแบบเก็บประวัติผ่านเซิร์ฟเวอร์'; end if;
    return old;
  end if;
  if old.deleted_at is not null then raise exception using errcode='23503',message='รายการถูกลบแล้ว'; end if;
  if (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
    and current_user not in ('postgres','supabase_admin') and coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='ต้องยืนยันการลบผ่านเซิร์ฟเวอร์';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_deletion on public.profiles;
create trigger guard_profile_deletion before update or delete on public.profiles for each row execute function public.guard_directory_deletion();
drop trigger if exists guard_station_deletion on public.sensor_stations;
create trigger guard_station_deletion before update or delete on public.sensor_stations for each row execute function public.guard_directory_deletion();
notify pgrst,'reload schema';
commit;
