create table public.fleet_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  vehicle_id uuid not null,
  service_type text not null check (length(trim(service_type)) between 2 and 80),
  description text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled')),
  due_on date not null,
  odometer_km integer check (odometer_km is null or odometer_km >= 0),
  completed_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete cascade,
  foreign key (organization_id, created_by)
    references public.organization_memberships (organization_id, user_id),
  check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index fleet_maintenance_records_org_due_idx
  on public.fleet_maintenance_records (organization_id, due_on);

create trigger fleet_maintenance_records_set_updated_at
  before update on public.fleet_maintenance_records
  for each row execute function public.set_updated_at();

create or replace function public.protect_fleet_maintenance_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.created_by <> (select auth.uid()) then
    raise exception 'The creating admin must be the signed-in user';
  end if;

  if tg_op = 'UPDATE' and new.created_by <> old.created_by then
    raise exception 'The original creating admin cannot be changed';
  end if;

  return new;
end;
$$;

create trigger fleet_maintenance_records_protect_creator
  before insert or update on public.fleet_maintenance_records
  for each row execute function public.protect_fleet_maintenance_record();

alter table public.fleet_maintenance_records enable row level security;

create policy fleet_maintenance_records_read_admin
  on public.fleet_maintenance_records for select
  to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']));

create policy fleet_maintenance_records_manage_admin
  on public.fleet_maintenance_records for all
  to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']))
  with check (public.has_organization_role(organization_id, array['owner', 'admin']));

grant select, insert, update, delete
  on public.fleet_maintenance_records to authenticated;
revoke all on function public.protect_fleet_maintenance_record() from public, anon, authenticated;
