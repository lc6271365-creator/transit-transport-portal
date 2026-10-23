alter table public.platform_settings
  add column price_per_vehicle_paise integer not null default 10000
    check (price_per_vehicle_paise between 100 and 10000000);

alter table public.organization_memberships
  add column login_name text;

alter table public.organization_memberships
  add column display_name text;

create unique index organization_memberships_login_name_unique
  on public.organization_memberships (organization_id, lower(login_name))
  where login_name is not null;

create table public.organization_access_codes (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  code_hash text not null,
  rotated_at timestamptz not null default now(),
  rotated_by uuid not null references auth.users(id)
);

alter table public.organization_access_codes enable row level security;

create or replace function public.rotate_organization_access_code(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_code text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.has_organization_role(
    target_organization_id,
    array['owner', 'admin']
  ) then
    raise exception 'Only organization Admins can rotate the reference code';
  end if;

  insert into public.organization_access_codes (
    organization_id,
    code_hash,
    rotated_by
  )
  values (
    target_organization_id,
    md5(generated_code),
    (select auth.uid())
  )
  on conflict (organization_id) do update
  set code_hash = excluded.code_hash,
      rotated_at = now(),
      rotated_by = excluded.rotated_by;

  return generated_code;
end;
$$;

create or replace function public.lookup_organization_by_access_code(code_to_check text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select access_code.organization_id
  from public.organization_access_codes access_code
  join public.organizations organization
    on organization.id = access_code.organization_id
  where access_code.code_hash = md5(trim(code_to_check))
    and organization.subscription_status in ('trial', 'active')
  limit 1;
$$;

create or replace function public.create_organization_with_access_code(
  organization_name text,
  organization_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
  generated_code text := replace(gen_random_uuid()::text, '-', '');
begin
  new_organization_id := public.create_organization(organization_name, organization_slug);

  insert into public.organization_access_codes (
    organization_id,
    code_hash,
    rotated_by
  )
  values (
    new_organization_id,
    md5(generated_code),
    (select auth.uid())
  );

  return jsonb_build_object(
    'organization_id', new_organization_id,
    'access_code', generated_code
  );
end;
$$;

revoke all on function public.rotate_organization_access_code(uuid) from public, anon;
revoke all on function public.lookup_organization_by_access_code(text) from public, anon, authenticated;
revoke all on function public.create_organization_with_access_code(text, text) from public, anon;
grant execute on function public.rotate_organization_access_code(uuid) to authenticated;
grant execute on function public.lookup_organization_by_access_code(text) to service_role;
grant execute on function public.create_organization_with_access_code(text, text) to authenticated;

revoke all on public.organization_access_codes from public, anon, authenticated;

create or replace function public.organization_can_operate(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations organization
    where organization.id = target_organization_id
      and organization.subscription_status in ('trial', 'active')
  );
$$;

revoke all on function public.organization_can_operate(uuid) from public, anon;
grant execute on function public.organization_can_operate(uuid) to authenticated;

drop policy route_assignments_read_members on public.route_assignments;
create policy route_assignments_read_members
  on public.route_assignments for select
  to authenticated
  using (
    public.has_organization_role(organization_id, array['owner', 'admin'])
    or (
      driver_user_id = (select auth.uid())
      and public.has_organization_role(organization_id, array['driver'])
    )
    or (
      public.has_organization_role(organization_id, array['student'])
      and exists (
        select 1 from public.rider_allocations allocation
        where allocation.organization_id = route_assignments.organization_id
          and allocation.route_assignment_id = route_assignments.id
          and allocation.student_user_id = (select auth.uid())
      )
    )
  );

drop policy rider_allocations_read_self_or_admin on public.rider_allocations;
create policy rider_allocations_read_self_or_admin
  on public.rider_allocations for select
  to authenticated
  using (
    (
      student_user_id = (select auth.uid())
      and public.has_organization_role(organization_id, array['student'])
    )
    or public.has_organization_role(organization_id, array['owner', 'admin'])
  );
