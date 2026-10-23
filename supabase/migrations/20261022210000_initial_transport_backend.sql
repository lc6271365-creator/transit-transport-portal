create table public.platform_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.platform_settings (
  singleton boolean primary key default true check (singleton),
  trial_days integer not null default 3 check (trial_days between 1 and 90),
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (singleton, trial_days)
values (true, 3);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
  trial_started_at timestamptz not null default now(),
  trial_ends_at timestamptz not null,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'driver', 'student')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id),
  check (
    (role = 'student' and external_id is not null)
    or (role <> 'student' and external_id is null)
  )
);

create unique index organization_memberships_external_id_unique
  on public.organization_memberships (organization_id, lower(external_id))
  where external_id is not null;

create unique index organization_memberships_one_owner
  on public.organization_memberships (organization_id)
  where role = 'owner';

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  registration_number text not null,
  label text,
  seat_capacity integer not null check (seat_capacity between 1 and 300),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index vehicles_registration_number_unique
  on public.vehicles (organization_id, lower(registration_number));

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index routes_code_unique
  on public.routes (organization_id, lower(code));

create table public.route_stops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  route_id uuid not null,
  stop_order integer not null check (stop_order > 0),
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  scheduled_time time,
  created_at timestamptz not null default now(),
  unique (route_id, stop_order),
  foreign key (organization_id, route_id)
    references public.routes (organization_id, id) on delete cascade
);

create table public.service_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check (ends_on >= starts_on)
);

create table public.route_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_period_id uuid not null,
  route_id uuid not null,
  vehicle_id uuid not null,
  driver_user_id uuid not null,
  status text not null default 'assigned'
    check (status in ('assigned', 'in_progress', 'disabled')),
  assigned_by uuid not null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, service_period_id)
    references public.service_periods (organization_id, id),
  foreign key (organization_id, route_id)
    references public.routes (organization_id, id),
  foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id),
  foreign key (organization_id, driver_user_id)
    references public.organization_memberships (organization_id, user_id),
  foreign key (organization_id, assigned_by)
    references public.organization_memberships (organization_id, user_id)
);

create unique index route_assignments_one_active_vehicle
  on public.route_assignments (organization_id, vehicle_id)
  where status in ('assigned', 'in_progress');

create unique index route_assignments_one_active_driver
  on public.route_assignments (organization_id, driver_user_id)
  where status in ('assigned', 'in_progress');

create table public.rider_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  route_assignment_id uuid not null,
  student_user_id uuid not null,
  seat_number integer not null check (seat_number > 0),
  allocated_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, route_assignment_id, student_user_id),
  unique (organization_id, route_assignment_id, seat_number),
  foreign key (organization_id, route_assignment_id)
    references public.route_assignments (organization_id, id) on delete cascade,
  foreign key (organization_id, student_user_id)
    references public.organization_memberships (organization_id, user_id),
  foreign key (organization_id, allocated_by)
    references public.organization_memberships (organization_id, user_id)
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  route_assignment_id uuid not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, route_assignment_id)
    references public.route_assignments (organization_id, id),
  check (
    (status = 'in_progress' and ended_at is null)
    or (status <> 'in_progress' and ended_at is not null)
  )
);

create unique index trips_one_active_per_assignment
  on public.trips (organization_id, route_assignment_id)
  where status = 'in_progress';

create table public.trip_location_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  trip_id uuid not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  speed_kmh numeric(6, 2) not null check (speed_kmh between 0 and 300),
  accuracy_m numeric(8, 2) check (accuracy_m is null or accuracy_m between 0 and 10000),
  recorded_at timestamptz not null default now(),
  foreign key (organization_id, trip_id)
    references public.trips (organization_id, id) on delete cascade
);

create index trip_location_history_trip_time_idx
  on public.trip_location_history (organization_id, trip_id, recorded_at);

create table public.current_vehicle_locations (
  trip_id uuid primary key,
  organization_id uuid not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  speed_kmh numeric(6, 2) not null check (speed_kmh between 0 and 300),
  accuracy_m numeric(8, 2) check (accuracy_m is null or accuracy_m between 0 and 10000),
  recorded_at timestamptz not null default now(),
  foreign key (organization_id, trip_id)
    references public.trips (organization_id, id) on delete cascade
);

create index current_vehicle_locations_organization_idx
  on public.current_vehicle_locations (organization_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger organization_memberships_set_updated_at
  before update on public.organization_memberships
  for each row execute function public.set_updated_at();
create trigger vehicles_set_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();
create trigger routes_set_updated_at
  before update on public.routes
  for each row execute function public.set_updated_at();
create trigger service_periods_set_updated_at
  before update on public.service_periods
  for each row execute function public.set_updated_at();
create trigger route_assignments_set_updated_at
  before update on public.route_assignments
  for each row execute function public.set_updated_at();

create or replace function public.is_platform_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_operators operator
    where operator.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_organization_role(
  target_organization_id uuid,
  allowed_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and (
        allowed_roles is null
        or membership.role = any (allowed_roles)
      )
  );
$$;

create or replace function public.can_view_trip(
  target_organization_id uuid,
  target_trip_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trips trip
    join public.route_assignments assignment
      on assignment.organization_id = trip.organization_id
     and assignment.id = trip.route_assignment_id
    where trip.organization_id = target_organization_id
      and trip.id = target_trip_id
      and (
        public.has_organization_role(target_organization_id, array['owner', 'admin'])
        or (
          assignment.driver_user_id = (select auth.uid())
          and public.has_organization_role(target_organization_id, array['driver'])
        )
        or exists (
          select 1
          from public.rider_allocations allocation
          where allocation.organization_id = trip.organization_id
            and allocation.route_assignment_id = assignment.id
            and allocation.student_user_id = (select auth.uid())
            and public.has_organization_role(target_organization_id, array['student'])
        )
      )
  );
$$;

create or replace function public.can_drive_assignment(
  target_organization_id uuid,
  target_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.route_assignments assignment
    where assignment.organization_id = target_organization_id
      and assignment.id = target_assignment_id
      and assignment.driver_user_id = (select auth.uid())
      and assignment.status in ('assigned', 'in_progress')
      and public.has_organization_role(target_organization_id, array['driver'])
  );
$$;

create or replace function public.user_has_organization_role(
  target_organization_id uuid,
  target_user_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role = any (allowed_roles)
  );
$$;

create or replace function public.validate_route_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.user_has_organization_role(
    new.organization_id,
    new.driver_user_id,
    array['driver']
  ) then
    raise exception 'The assigned user must be an active driver in this organization';
  end if;

  if not public.has_organization_role(new.organization_id, array['owner', 'admin']) then
    raise exception 'Only an organization admin can assign a route';
  end if;

  if tg_op = 'INSERT' then
    if new.assigned_by <> (select auth.uid()) then
      raise exception 'The assigning admin must be the signed-in user';
    end if;
  elsif new.organization_id <> old.organization_id
    or new.assigned_by <> old.assigned_by
  then
    raise exception 'The organization and original assigning admin cannot be changed';
  end if;

  return new;
end;
$$;

create trigger route_assignments_validate
  before insert or update on public.route_assignments
  for each row execute function public.validate_route_assignment();

create or replace function public.validate_rider_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  vehicle_capacity integer;
begin
  if not public.has_organization_role(new.organization_id, array['owner', 'admin']) then
    raise exception 'Only an organization admin can allocate seats';
  end if;

  if tg_op = 'INSERT' then
    if new.allocated_by <> (select auth.uid()) then
      raise exception 'The allocating admin must be the signed-in user';
    end if;
  elsif new.organization_id <> old.organization_id
    or new.allocated_by <> old.allocated_by
  then
    raise exception 'The organization and original allocating admin cannot be changed';
  end if;

  if not public.user_has_organization_role(
    new.organization_id,
    new.student_user_id,
    array['student']
  ) then
    raise exception 'The allocated user must be an active student in this organization';
  end if;

  select vehicle.seat_capacity
  into vehicle_capacity
  from public.route_assignments assignment
  join public.vehicles vehicle
    on vehicle.organization_id = assignment.organization_id
   and vehicle.id = assignment.vehicle_id
  where assignment.organization_id = new.organization_id
    and assignment.id = new.route_assignment_id
    and vehicle.is_active;

  if vehicle_capacity is null or new.seat_number > vehicle_capacity then
    raise exception 'The selected seat is outside the vehicle capacity';
  end if;

  return new;
end;
$$;

create trigger rider_allocations_validate
  before insert or update on public.rider_allocations
  for each row execute function public.validate_rider_allocation();

create or replace function public.organization_can_operate(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations organization
    where organization.id = target_organization_id
      and (
        organization.subscription_status = 'active'
        or (
          organization.subscription_status = 'trial'
          and organization.trial_ends_at > now()
        )
      )
  );
$$;

create or replace function public.create_organization(
  organization_name text,
  organization_slug text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
  owner_user_id uuid := (select auth.uid());
  configured_trial_days integer;
begin
  if owner_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not exists (
    select 1
    from auth.users account
    where account.id = owner_user_id
      and account.email_confirmed_at is not null
  ) then
    raise exception 'Verify your email before creating an organization';
  end if;

  if organization_name is null or length(trim(organization_name)) not between 2 and 120 then
    raise exception 'Organization name must be between 2 and 120 characters';
  end if;

  if organization_slug is null
    or length(organization_slug) not between 3 and 63
    or organization_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    raise exception 'Organization slug must be 3-63 lowercase letters, numbers, or hyphens';
  end if;

  select settings.trial_days
  into strict configured_trial_days
  from public.platform_settings settings
  where settings.singleton;

  insert into public.organizations (
    name,
    slug,
    trial_ends_at
  )
  values (
    trim(organization_name),
    organization_slug,
    now() + make_interval(days => configured_trial_days)
  )
  returning id into new_organization_id;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    status
  )
  values (
    new_organization_id,
    owner_user_id,
    'owner',
    'active'
  );

  return new_organization_id;
end;
$$;

create or replace function public.start_trip(target_assignment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_record public.route_assignments%rowtype;
  new_trip_id uuid;
begin
  select assignment.*
  into assignment_record
  from public.route_assignments assignment
  where assignment.id = target_assignment_id
    and assignment.driver_user_id = (select auth.uid())
    and assignment.status in ('assigned', 'in_progress')
    and public.has_organization_role(assignment.organization_id, array['driver'])
    and public.organization_can_operate(assignment.organization_id)
  for update;

  if not found then
    raise exception 'No active authorized assignment is available';
  end if;

  update public.route_assignments
  set status = 'in_progress'
  where id = target_assignment_id;

  insert into public.trips (organization_id, route_assignment_id)
  values (assignment_record.organization_id, assignment_record.id)
  returning id into new_trip_id;

  return new_trip_id;
end;
$$;

create or replace function public.record_trip_location(
  target_trip_id uuid,
  point_latitude double precision,
  point_longitude double precision,
  point_speed_kmh numeric,
  point_accuracy_m numeric default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  recorded_time timestamptz := now();
begin
  if point_latitude is null or point_latitude not between -90 and 90
    or point_longitude is null or point_longitude not between -180 and 180
    or point_speed_kmh is null or point_speed_kmh not between 0 and 300
    or (point_accuracy_m is not null and point_accuracy_m not between 0 and 10000)
  then
    raise exception 'Invalid location telemetry';
  end if;

  select trip.organization_id
  into target_organization_id
  from public.trips trip
  join public.route_assignments assignment
    on assignment.organization_id = trip.organization_id
   and assignment.id = trip.route_assignment_id
  where trip.id = target_trip_id
    and trip.status = 'in_progress'
    and assignment.driver_user_id = (select auth.uid())
    and assignment.status = 'in_progress'
    and public.has_organization_role(trip.organization_id, array['driver'])
  for update of trip;

  if not found then
    raise exception 'No active trip is available for this driver';
  end if;

  insert into public.trip_location_history (
    organization_id,
    trip_id,
    latitude,
    longitude,
    speed_kmh,
    accuracy_m,
    recorded_at
  )
  values (
    target_organization_id,
    target_trip_id,
    point_latitude,
    point_longitude,
    point_speed_kmh,
    point_accuracy_m,
    recorded_time
  );

  insert into public.current_vehicle_locations (
    organization_id,
    trip_id,
    latitude,
    longitude,
    speed_kmh,
    accuracy_m,
    recorded_at
  )
  values (
    target_organization_id,
    target_trip_id,
    point_latitude,
    point_longitude,
    point_speed_kmh,
    point_accuracy_m,
    recorded_time
  )
  on conflict (trip_id) do update
  set latitude = excluded.latitude,
      longitude = excluded.longitude,
      speed_kmh = excluded.speed_kmh,
      accuracy_m = excluded.accuracy_m,
      recorded_at = excluded.recorded_at;

  return recorded_time;
end;
$$;

create or replace function public.finish_trip(target_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_assignment_id uuid;
begin
  select trip.organization_id, trip.route_assignment_id
  into target_organization_id, target_assignment_id
  from public.trips trip
  join public.route_assignments assignment
    on assignment.organization_id = trip.organization_id
   and assignment.id = trip.route_assignment_id
  where trip.id = target_trip_id
    and trip.status = 'in_progress'
    and assignment.driver_user_id = (select auth.uid())
    and public.has_organization_role(trip.organization_id, array['driver'])
  for update of trip;

  if not found then
    raise exception 'No active trip is available for this driver';
  end if;

  update public.trips
  set status = 'completed',
      ended_at = now()
  where id = target_trip_id;

  update public.route_assignments
  set status = 'assigned'
  where id = target_assignment_id
    and organization_id = target_organization_id;

  delete from public.current_vehicle_locations
  where trip_id = target_trip_id;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.is_platform_operator() from public, anon;
revoke all on function public.has_organization_role(uuid, text[]) from public, anon;
revoke all on function public.can_view_trip(uuid, uuid) from public, anon;
revoke all on function public.can_drive_assignment(uuid, uuid) from public, anon;
revoke all on function public.user_has_organization_role(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.validate_route_assignment() from public, anon, authenticated;
revoke all on function public.validate_rider_allocation() from public, anon, authenticated;
revoke all on function public.organization_can_operate(uuid) from public, anon;
revoke all on function public.create_organization(text, text) from public, anon;
revoke all on function public.start_trip(uuid) from public, anon;
revoke all on function public.record_trip_location(uuid, double precision, double precision, numeric, numeric) from public, anon;
revoke all on function public.finish_trip(uuid) from public, anon;

grant execute on function public.is_platform_operator() to authenticated;
grant execute on function public.has_organization_role(uuid, text[]) to authenticated;
grant execute on function public.can_view_trip(uuid, uuid) to authenticated;
grant execute on function public.can_drive_assignment(uuid, uuid) to authenticated;
grant execute on function public.organization_can_operate(uuid) to authenticated;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.start_trip(uuid) to authenticated;
grant execute on function public.record_trip_location(uuid, double precision, double precision, numeric, numeric) to authenticated;
grant execute on function public.finish_trip(uuid) to authenticated;

alter table public.platform_operators enable row level security;
alter table public.platform_settings enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.vehicles enable row level security;
alter table public.routes enable row level security;
alter table public.route_stops enable row level security;
alter table public.service_periods enable row level security;
alter table public.route_assignments enable row level security;
alter table public.rider_allocations enable row level security;
alter table public.trips enable row level security;
alter table public.trip_location_history enable row level security;
alter table public.current_vehicle_locations enable row level security;

create policy platform_operators_read_self
  on public.platform_operators for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy platform_settings_platform_read
  on public.platform_settings for select
  to authenticated
  using (public.is_platform_operator());

create policy organizations_read_members_or_platform
  on public.organizations for select
  to authenticated
  using (
    public.is_platform_operator()
    or public.has_organization_role(id)
  );

create policy organizations_admin_update
  on public.organizations for update
  to authenticated
  using (public.has_organization_role(id, array['owner', 'admin']))
  with check (public.has_organization_role(id, array['owner', 'admin']));

grant select on public.platform_operators to authenticated;
grant select on public.platform_settings to authenticated;
grant select on public.organizations to authenticated;
grant update (name, timezone) on public.organizations to authenticated;

create policy organization_memberships_read_self_or_admin
  on public.organization_memberships for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_organization_role(organization_id, array['owner', 'admin'])
  );

create policy vehicles_read_members
  on public.vehicles for select
  to authenticated
  using (public.has_organization_role(organization_id));
create policy vehicles_admin_manage
  on public.vehicles for all
  to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']))
  with check (public.has_organization_role(organization_id, array['owner', 'admin']));

create policy routes_read_members
  on public.routes for select
  to authenticated
  using (public.has_organization_role(organization_id));
create policy routes_admin_manage
  on public.routes for all
  to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']))
  with check (public.has_organization_role(organization_id, array['owner', 'admin']));

create policy route_stops_read_members
  on public.route_stops for select
  to authenticated
  using (public.has_organization_role(organization_id));
create policy route_stops_admin_manage
  on public.route_stops for all
  to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']))
  with check (public.has_organization_role(organization_id, array['owner', 'admin']));

create policy service_periods_read_members
  on public.service_periods for select
  to authenticated
  using (public.has_organization_role(organization_id));
create policy service_periods_admin_manage
  on public.service_periods for all
  to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']))
  with check (public.has_organization_role(organization_id, array['owner', 'admin']));

create policy route_assignments_read_members
  on public.route_assignments for select
  to authenticated
  using (
    public.has_organization_role(organization_id, array['owner', 'admin'])
    or (
      driver_user_id = (select auth.uid())
      and public.has_organization_role(organization_id, array['driver'])
    )
    or exists (
      select 1 from public.rider_allocations allocation
      where allocation.organization_id = route_assignments.organization_id
        and allocation.route_assignment_id = route_assignments.id
        and allocation.student_user_id = (select auth.uid())
    )
  );
create policy route_assignments_admin_manage
  on public.route_assignments for all
  to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']))
  with check (public.has_organization_role(organization_id, array['owner', 'admin']));

create policy rider_allocations_read_self_or_admin
  on public.rider_allocations for select
  to authenticated
  using (
    student_user_id = (select auth.uid())
    or public.has_organization_role(organization_id, array['owner', 'admin'])
  );
create policy rider_allocations_admin_manage
  on public.rider_allocations for all
  to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']))
  with check (public.has_organization_role(organization_id, array['owner', 'admin']));

create policy trips_read_authorized_users
  on public.trips for select
  to authenticated
  using (public.can_view_trip(organization_id, id));

create policy trip_location_history_read_authorized_users
  on public.trip_location_history for select
  to authenticated
  using (public.can_view_trip(organization_id, trip_id));

create policy current_vehicle_locations_read_authorized_users
  on public.current_vehicle_locations for select
  to authenticated
  using (public.can_view_trip(organization_id, trip_id));

grant select on public.organization_memberships to authenticated;
grant select, insert, update, delete on
  public.vehicles,
  public.routes,
  public.route_stops,
  public.service_periods,
  public.route_assignments,
  public.rider_allocations
to authenticated;
grant select on public.trips, public.trip_location_history, public.current_vehicle_locations to authenticated;
revoke insert, update, delete on
  public.trips,
  public.trip_location_history,
  public.current_vehicle_locations,
  public.platform_operators,
  public.platform_settings,
  public.organizations,
  public.organization_memberships
from anon, authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'trips'
    ) then
      alter publication supabase_realtime add table public.trips;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'current_vehicle_locations'
    ) then
      alter publication supabase_realtime add table public.current_vehicle_locations;
    end if;
  end if;
end;
$$;
