CREATE TABLE IF NOT EXISTS vehicle_route_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jeepney_id uuid REFERENCES jeepneys(id) ON DELETE RESTRICT,
  group_id uuid REFERENCES fleet_groups(id) ON DELETE RESTRICT,
  route_direction_id uuid NOT NULL REFERENCES route_directions(id) ON DELETE RESTRICT,
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  active_from timestamptz NOT NULL DEFAULT now(),
  active_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((jeepney_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer = 1),
  CHECK (active_to IS NULL OR active_to > active_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_route_assignments_active_jeepney_uidx
  ON vehicle_route_assignments(jeepney_id) WHERE jeepney_id IS NOT NULL AND active_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_route_assignments_active_group_uidx
  ON vehicle_route_assignments(group_id) WHERE group_id IS NOT NULL AND active_to IS NULL;
CREATE INDEX IF NOT EXISTS vehicle_route_assignments_direction_idx
  ON vehicle_route_assignments(route_direction_id, active_from DESC);
