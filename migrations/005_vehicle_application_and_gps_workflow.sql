DO $$ BEGIN
  CREATE TYPE vehicle_application_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE gps_setup_status AS ENUM ('PENDING', 'APPROVED', 'SCHEDULED', 'INSTALLED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE gps_verification_status AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS vehicle_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jeepney_id uuid NOT NULL REFERENCES jeepneys(id) ON DELETE RESTRICT,
  submitted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status vehicle_application_status NOT NULL DEFAULT 'PENDING',
  applicant_notes text,
  review_notes text,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'PENDING' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
    OR (status <> 'PENDING' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_applications_open_jeepney_uidx
  ON vehicle_applications(jeepney_id) WHERE status IN ('PENDING', 'APPROVED');
CREATE INDEX IF NOT EXISTS vehicle_applications_submitter_idx
  ON vehicle_applications(submitted_by_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gps_setup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_application_id uuid NOT NULL UNIQUE REFERENCES vehicle_applications(id) ON DELETE RESTRICT,
  jeepney_id uuid NOT NULL REFERENCES jeepneys(id) ON DELETE RESTRICT,
  requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status gps_setup_status NOT NULL DEFAULT 'PENDING',
  verification_status gps_verification_status NOT NULL DEFAULT 'NOT_STARTED',
  scheduled_at timestamptz,
  installed_at timestamptz,
  rejected_reason text,
  verification_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'SCHEDULED' OR scheduled_at IS NOT NULL),
  CHECK (status <> 'INSTALLED' OR installed_at IS NOT NULL),
  CHECK (verification_status <> 'VERIFIED' OR (verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS gps_setup_requests_jeepney_idx
  ON gps_setup_requests(jeepney_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gps_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imei text NOT NULL UNIQUE CHECK (imei ~ '^[0-9]{14,17}$'),
  serial_number text NOT NULL UNIQUE,
  status record_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS traccar_device_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gps_setup_request_id uuid NOT NULL UNIQUE REFERENCES gps_setup_requests(id) ON DELETE RESTRICT,
  gps_device_id uuid NOT NULL UNIQUE REFERENCES gps_devices(id) ON DELETE RESTRICT,
  jeepney_id uuid NOT NULL UNIQUE REFERENCES jeepneys(id) ON DELETE RESTRICT,
  traccar_unique_id text NOT NULL UNIQUE,
  mapped_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mapped_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS traccar_device_mappings_unique_id_idx
  ON traccar_device_mappings(traccar_unique_id);
