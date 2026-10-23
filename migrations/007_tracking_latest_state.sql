-- Stage 13b B007 (Agent B): durable latest tracking state and the Bridge writer lease.
-- Depends on Agent A 006 (jeepneys.tracking_context_version / tracking_context_changed_at), which the
-- writer reads under the shared advisory key; this file stores only B-owned snapshots of those values.
-- Plain CREATE (no IF NOT EXISTS): an unexpected pre-existing object must fail the migration loudly.

CREATE TABLE tracking_bridge_leases (
  deployment_key text PRIMARY KEY CHECK (deployment_key = 'primary'),
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  owner_id uuid,
  expires_at timestamptz,
  heartbeat_at timestamptz,
  phase text NOT NULL DEFAULT 'STOPPED'
    CHECK (phase IN ('STOPPED', 'AUTHENTICATING', 'CONNECTING', 'RECONCILING', 'RUNNING', 'BACKOFF', 'STOPPING')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (num_nulls(owner_id, expires_at, heartbeat_at) IN (0, 3)),
  CHECK (owner_id IS NULL OR fence > 0)
);

INSERT INTO tracking_bridge_leases(deployment_key) VALUES ('primary');

CREATE TABLE vehicle_latest_states (
  jeepney_id uuid PRIMARY KEY REFERENCES jeepneys(id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  writer_fence bigint NOT NULL CHECK (writer_fence > 0),

  -- Mapping generation provenance (create-only mapping: id + mapped_at). No FK to the mapping on purpose.
  mapping_id uuid,
  gps_device_id uuid REFERENCES gps_devices(id) ON DELETE RESTRICT,
  mapping_mapped_at timestamptz,
  mapping_fingerprint text CHECK (mapping_fingerprint ~ '^[0-9a-f]{64}$'),
  traccar_device_id bigint CHECK (traccar_device_id > 0),

  -- Last accepted valid fix. NaN and infinities fail every range check below.
  traccar_position_id bigint CHECK (traccar_position_id > 0),
  fix_time timestamptz,
  device_time timestamptz,
  server_time timestamptz,
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  position geometry(Point, 4326) GENERATED ALWAYS AS (
    CASE WHEN longitude IS NULL OR latitude IS NULL THEN NULL
         ELSE ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) END
  ) STORED,
  speed_kph double precision CHECK (speed_kph BETWEEN 0 AND 300),
  heading double precision CHECK (heading >= 0 AND heading < 360),
  last_successful_update_at timestamptz,
  fresh_until timestamptz,

  -- Latest orderable observation (valid or invalid) and provenance-only receipt time.
  observed_at timestamptz,
  received_at timestamptz,
  location_status text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (location_status IN ('UNKNOWN', 'FRESH', 'STALE', 'INVALID')),
  location_reason text NOT NULL DEFAULT 'NO_FIX'
    CHECK (location_reason IN ('NO_FIX', 'VALID_FIX', 'INVALID_FIX', 'EXPIRED', 'INELIGIBLE', 'UNMAPPED',
                               'MAPPING_CHANGED', 'CLOCK_AHEAD', 'CONTEXT_CHANGED', 'LEASE_LOST')),

  tracker_status text NOT NULL DEFAULT 'UNKNOWN' CHECK (tracker_status IN ('UNKNOWN', 'ONLINE', 'OFFLINE')),
  status_source_time timestamptz,
  status_observed_at timestamptz,
  status_source text NOT NULL DEFAULT 'NONE' CHECK (status_source IN ('NONE', 'DEVICE', 'EVENT', 'REST_RECONCILIATION')),
  status_epoch bigint CHECK (status_epoch > 0),
  status_sequence bigint CHECK (status_sequence >= 0),
  motion_status text NOT NULL DEFAULT 'UNKNOWN' CHECK (motion_status IN ('UNKNOWN', 'MOVING', 'STOPPED')),

  -- Route context snapshot resolved through Agent A's resolver; never an assignment of its own.
  route_direction_id uuid REFERENCES route_directions(id) ON DELETE RESTRICT,
  route_assignment_id uuid,
  route_resolution text NOT NULL DEFAULT 'UNASSIGNED'
    CHECK (route_resolution IN ('UNASSIGNED', 'RESOLVED', 'CONFLICT', 'INACTIVE')),
  context_version bigint CHECK (context_version > 0),
  context_cutover_at timestamptz,
  context_fingerprint text CHECK (context_fingerprint ~ '^[0-9a-f]{64}$'),

  -- Compliance debounce (frozen: 30 s or 3 outside fixes to deviate, 2 inside fixes to re-enter).
  route_compliance text NOT NULL DEFAULT 'UNKNOWN' CHECK (route_compliance IN ('UNKNOWN', 'ON_ROUTE', 'OFF_ROUTE')),
  distance_m double precision CHECK (distance_m >= 0 AND distance_m < 'Infinity'),
  outside_since timestamptz,
  consecutive_outside smallint NOT NULL DEFAULT 0 CHECK (consecutive_outside BETWEEN 0 AND 3),
  consecutive_inside smallint NOT NULL DEFAULT 0 CHECK (consecutive_inside BETWEEN 0 AND 2),
  reentry_required boolean NOT NULL DEFAULT false,
  compliance_changed_at timestamptz,

  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CHECK (num_nulls(mapping_id, gps_device_id, mapping_mapped_at, mapping_fingerprint, traccar_device_id) IN (0, 5)),
  CHECK (num_nulls(traccar_position_id, fix_time, device_time, server_time, latitude, longitude,
                   speed_kph, heading, last_successful_update_at, fresh_until) IN (0, 10)),
  CHECK (fresh_until IS NULL OR fresh_until = fix_time + interval '30 seconds'),
  CHECK (fix_time IS NULL OR mapping_id IS NOT NULL),
  CHECK (fix_time IS NULL OR (observed_at IS NOT NULL AND observed_at >= fix_time)),
  CHECK (location_status <> 'FRESH' OR (fix_time IS NOT NULL AND location_reason = 'VALID_FIX')),
  CHECK (num_nulls(status_epoch, status_sequence) IN (0, 2)),
  CHECK (status_source <> 'NONE' OR tracker_status = 'UNKNOWN'),
  CHECK (num_nulls(context_version, context_cutover_at) IN (0, 2)),
  CHECK (route_resolution <> 'RESOLVED' OR (route_direction_id IS NOT NULL AND context_version IS NOT NULL)),
  CHECK (route_resolution <> 'UNASSIGNED' OR route_direction_id IS NULL),
  CHECK (location_status = 'FRESH' OR route_compliance = 'UNKNOWN'),
  CHECK (route_compliance = 'UNKNOWN' OR route_resolution = 'RESOLVED'),
  CHECK ((outside_since IS NULL) = (consecutive_outside = 0)),
  CHECK (consecutive_outside = 0 OR consecutive_inside = 0),
  CHECK (route_compliance <> 'OFF_ROUTE' OR reentry_required),
  CHECK (route_compliance <> 'ON_ROUTE' OR NOT reentry_required)
);

CREATE INDEX vehicle_latest_states_fresh_until_idx
  ON vehicle_latest_states(fresh_until) WHERE location_status = 'FRESH';
CREATE INDEX vehicle_latest_states_direction_idx
  ON vehicle_latest_states(route_direction_id, jeepney_id);
