CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

DO $$ BEGIN
  CREATE TYPE record_status AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS transit_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_code citext NOT NULL UNIQUE,
  public_name text NOT NULL,
  description text,
  route_color_hex text NOT NULL CHECK (route_color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  status record_status NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS route_directions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES transit_routes(id) ON DELETE RESTRICT,
  direction_label text NOT NULL,
  origin_name text NOT NULL,
  destination_name text NOT NULL,
  geometry geometry(LineString, 4326) NOT NULL,
  corridor_m integer NOT NULL DEFAULT 100 CHECK (corridor_m BETWEEN 1 AND 5000),
  status record_status NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id, direction_label)
);
CREATE INDEX IF NOT EXISTS route_directions_geometry_gist ON route_directions USING gist (geometry);
