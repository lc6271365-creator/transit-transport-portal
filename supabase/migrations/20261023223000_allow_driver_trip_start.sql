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

  if tg_op = 'UPDATE'
    and (
      (old.status = 'assigned' and new.status = 'in_progress')
      or (old.status = 'in_progress' and new.status = 'assigned')
    )
    and new.organization_id = old.organization_id
    and new.service_period_id = old.service_period_id
    and new.route_id = old.route_id
    and new.vehicle_id = old.vehicle_id
    and new.driver_user_id = old.driver_user_id
    and new.assigned_by = old.assigned_by
    and new.assigned_at = old.assigned_at
    and new.created_at = old.created_at
    and new.driver_user_id = (select auth.uid())
    and public.has_organization_role(new.organization_id, array['driver'])
  then
    return new;
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
