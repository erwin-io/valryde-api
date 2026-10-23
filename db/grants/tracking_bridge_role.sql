-- Stage 13b M4 (CONDITIONALLY APPROVED design): least-privilege group role for the Tracking Bridge writer.
-- NOT a migration and never applied automatically. Infrastructure applies it to a named database after
-- review, with search_path set to the application schema, then grants this NOLOGIN role to a login role.
-- CI applies it only inside a rolled-back transaction on the disposable PostGIS service.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'valryde_tracking_bridge') THEN
    CREATE ROLE valryde_tracking_bridge NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO valryde_tracking_bridge', current_schema());
END $$;

-- Agent A business context: read only (mapping/eligibility joins, effective-route resolver, context version).
GRANT SELECT ON
  jeepneys, operators, fleet_groups, fleet_group_jeepneys, vehicle_route_assignments,
  transit_routes, route_directions,
  vehicle_applications, gps_setup_requests, gps_devices, traccar_device_mappings
TO valryde_tracking_bridge;

-- Agent B state: no DELETE/TRUNCATE anywhere; events are append-only.
GRANT SELECT, UPDATE ON tracking_bridge_leases TO valryde_tracking_bridge;
GRANT SELECT, INSERT, UPDATE ON vehicle_latest_states TO valryde_tracking_bridge;
GRANT SELECT, INSERT ON route_compliance_events TO valryde_tracking_bridge;

-- pg_advisory_xact_lock and PostGIS functions are executable by PUBLIC by default; nothing else is granted.
