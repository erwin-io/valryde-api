-- Stage 13b (A006): A-owned, monotonic per-jeepney tracking context generation.
-- Every material context mutation bumps the version and sets the cutover with clock_timestamp()
-- after taking the shared advisory key (design: docs/design/stage13b, Amendment 1, X4).
ALTER TABLE jeepneys
  ADD COLUMN IF NOT EXISTS tracking_context_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tracking_context_changed_at timestamptz NOT NULL DEFAULT clock_timestamp();

DO $$ BEGIN
  ALTER TABLE jeepneys
    ADD CONSTRAINT jeepneys_tracking_context_version_positive CHECK (tracking_context_version > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
