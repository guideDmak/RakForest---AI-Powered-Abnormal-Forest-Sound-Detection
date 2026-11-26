begin;

create or replace function public.save_field_inspection_evidence(
  p_report_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_outcome text,
  p_notes text,
  p_evidence jsonb
)
returns timestamptz
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  saved_at timestamptz := now();
begin
  update public.reports
  set status = case when status in ('confirmed', 'rejected') then status else 'submitted' end,
      field_outcome = p_outcome,
      field_notes = p_notes,
      submitted_at = saved_at,
      reviewed_at = null,
      updated_at = saved_at
  where id = p_report_id
    and status = p_expected_status
    and status <> 'closed'
    and updated_at is not distinct from p_expected_updated_at
    and (acknowledged_at is not null or status = 'acknowledged')
    and submitted_at is null
  returning updated_at into saved_at;

  if not found then
    raise exception 'Report changed before inspection could be saved' using errcode = '40001';
  end if;

  insert into public.report_evidence (
    id, report_id, file_url, file_name, file_type, uploaded_by, uploaded_at
  )
  select id, p_report_id, file_url, file_name, file_type, uploaded_by, saved_at
  from jsonb_to_recordset(p_evidence) as item(
    id uuid, file_url text, file_name text, file_type text, uploaded_by uuid
  );

  return saved_at;
end;
$$;

commit;