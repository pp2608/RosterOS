begin;

create or replace function public.save_roster(p_roster jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved_roster_id uuid;
begin
  insert into public.rosters(id, month, status, generated_at, validated_at)
  values (
    (p_roster->>'id')::uuid,
    (p_roster->>'month')::date,
    p_roster->>'status',
    coalesce((p_roster->>'generated_at')::timestamptz, now()),
    (p_roster->>'validated_at')::timestamptz
  )
  on conflict (month) do update set
    status = excluded.status,
    generated_at = excluded.generated_at,
    validated_at = excluded.validated_at
  where public.rosters.id = excluded.id
  returning id into saved_roster_id;

  if saved_roster_id is null then
    raise exception 'A different roster already exists for this month.';
  end if;

  delete from public.roster_entries
  where roster_id = saved_roster_id;

  insert into public.roster_entries(
    id, roster_id, work_date, brand_id, process_id, employee_id, source
  )
  select
    entry.id,
    saved_roster_id,
    entry.work_date,
    entry.brand_id,
    entry.process_id,
    entry.employee_id,
    entry.source
  from jsonb_to_recordset(coalesce(p_roster->'entries', '[]'::jsonb)) as entry(
    id uuid,
    work_date date,
    brand_id uuid,
    process_id uuid,
    employee_id uuid,
    source text
  );

  return saved_roster_id;
end;
$$;

revoke execute on function public.save_roster(jsonb) from public, anon, authenticated;
grant execute on function public.save_roster(jsonb) to service_role;

commit;
