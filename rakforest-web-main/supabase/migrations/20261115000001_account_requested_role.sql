-- Additive migration: existing accounts retain their current role and status.
begin;
alter table public.profiles add column if not exists requested_role text
  check (requested_role in ('field_ranger', 'officer_backoffice', 'super_admin'));
notify pgrst, 'reload schema';
commit;
