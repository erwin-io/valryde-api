-- Stage 13b B008 (Agent B): Valryde route-compliance transitions only (never every fix or native event).
-- Retention is not approved (M5): no purge job exists and rows are kept.

CREATE TABLE route_compliance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jeepney_id uuid NOT NULL REFERENCES vehicle_latest_states(jeepney_id) ON DELETE RESTRICT,
  route_direction_id uuid NOT NULL REFERENCES route_directions(id) ON DELETE RESTRICT,
  mapping_id uuid NOT NULL,
  context_version bigint NOT NULL CHECK (context_version > 0),
  context_fingerprint text NOT NULL CHECK (context_fingerprint ~ '^[0-9a-f]{64}$'),
  state_revision bigint NOT NULL CHECK (state_revision > 0),
  event_type text NOT NULL CHECK (event_type IN ('ROUTE_DEVIATION', 'ROUTE_REENTRY')),
  from_state text NOT NULL CHECK (from_state IN ('UNKNOWN', 'ON_ROUTE', 'OFF_ROUTE')),
  to_state text NOT NULL CHECK (to_state IN ('ON_ROUTE', 'OFF_ROUTE')),
  fix_time timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  traccar_position_id bigint NOT NULL CHECK (traccar_position_id > 0),
  distance_m double precision NOT NULL CHECK (distance_m >= 0 AND distance_m < 'Infinity'),
  corridor_m integer NOT NULL CHECK (corridor_m BETWEEN 1 AND 5000),
  -- Provenance only; authorization always re-reads current Agent A ownership.
  operator_id_at_event uuid,
  source text NOT NULL DEFAULT 'VALRYDE' CHECK (source = 'VALRYDE'),
  -- A retried transition for the same state revision is idempotent.
  UNIQUE (jeepney_id, state_revision),
  CHECK ((event_type = 'ROUTE_DEVIATION' AND to_state = 'OFF_ROUTE' AND from_state IN ('UNKNOWN', 'ON_ROUTE'))
      OR (event_type = 'ROUTE_REENTRY' AND to_state = 'ON_ROUTE' AND from_state IN ('UNKNOWN', 'OFF_ROUTE'))),
  CHECK (event_type <> 'ROUTE_DEVIATION' OR distance_m > corridor_m),
  CHECK (event_type <> 'ROUTE_REENTRY' OR distance_m <= corridor_m)
);

CREATE INDEX route_compliance_events_jeepney_idx
  ON route_compliance_events(jeepney_id, fix_time DESC, id);
CREATE INDEX route_compliance_events_direction_idx
  ON route_compliance_events(route_direction_id, fix_time DESC, id);
