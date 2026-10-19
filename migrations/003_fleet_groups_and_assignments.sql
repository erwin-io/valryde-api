DO $$ BEGIN
  CREATE TYPE jeepney_status AS ENUM (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'INACTIVE', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS jeepneys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid REFERENCES operators(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plate_no citext NOT NULL UNIQUE,
  color_hex text NOT NULL CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  description text,
  status jeepney_status NOT NULL DEFAULT 'DRAFT',
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jeepneys_operator_id_idx ON jeepneys(operator_id);

CREATE TABLE IF NOT EXISTS fleet_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text,
  status record_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, name)
);
CREATE INDEX IF NOT EXISTS fleet_groups_operator_id_idx ON fleet_groups(operator_id);

CREATE TABLE IF NOT EXISTS fleet_group_jeepneys (
  group_id uuid NOT NULL REFERENCES fleet_groups(id) ON DELETE CASCADE,
  jeepney_id uuid NOT NULL REFERENCES jeepneys(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, jeepney_id)
);
CREATE INDEX IF NOT EXISTS fleet_group_jeepneys_jeepney_idx ON fleet_group_jeepneys(jeepney_id);

CREATE TABLE IF NOT EXISTS fleet_group_drivers (
  group_id uuid NOT NULL REFERENCES fleet_groups(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, driver_id)
);
CREATE INDEX IF NOT EXISTS fleet_group_drivers_driver_idx ON fleet_group_drivers(driver_id);

CREATE TABLE IF NOT EXISTS driver_jeepney_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  jeepney_id uuid NOT NULL REFERENCES jeepneys(id) ON DELETE RESTRICT,
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  active_from timestamptz NOT NULL DEFAULT now(),
  active_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (active_to IS NULL OR active_to > active_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS driver_jeepney_assignments_active_jeepney_uidx
  ON driver_jeepney_assignments(jeepney_id) WHERE active_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS driver_jeepney_assignments_active_driver_uidx
  ON driver_jeepney_assignments(driver_id) WHERE active_to IS NULL;
CREATE INDEX IF NOT EXISTS driver_jeepney_assignments_driver_idx
  ON driver_jeepney_assignments(driver_id, active_from DESC);
