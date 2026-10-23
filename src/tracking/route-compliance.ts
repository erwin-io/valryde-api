// Frozen Stage 13b compliance rules (B0 matrix, design §Effective compliance state machine).
export const deviationFixes = 3;
export const deviationWindowMs = 30_000;
export const reentryFixes = 2;

export type RouteCompliance = 'UNKNOWN' | 'ON_ROUTE' | 'OFF_ROUTE';
export type ComplianceEventType = 'ROUTE_DEVIATION' | 'ROUTE_REENTRY';

/** The vehicle_latest_states debounce columns, mutated in place. */
export interface ComplianceFields {
  route_compliance: RouteCompliance;
  distance_m: number | null;
  outside_since: Date | null;
  consecutive_outside: number;
  consecutive_inside: number;
  reentry_required: boolean;
  compliance_changed_at: Date | null;
}

export interface QualifyingFix {
  /** ST_DWithin(point, line, corridor_m, true): distance <= corridor is inside. */
  inside: boolean;
  distanceM: number;
  fixTime: Date;
  /** The previous fix in this context was valid, uninterrupted and at most 30 s earlier. */
  continuous: boolean;
  now: Date;
}

export interface ComplianceTransition {
  eventType: ComplianceEventType;
  fromState: RouteCompliance;
  toState: RouteCompliance;
}

/**
 * Applies one newly accepted, fresh fix on a RESOLVED route. Returns the transition that must be
 * recorded in the same transaction, or null. Counters count accepted fixes only and saturate.
 */
export function applyQualifyingFix(state: ComplianceFields, fix: QualifyingFix): ComplianceTransition | null {
  const from = state.route_compliance;
  if (!fix.continuous) Object.assign(state, { outside_since: null, consecutive_outside: 0, consecutive_inside: 0 });
  state.distance_m = fix.distanceM;
  let to = from;
  let eventType: ComplianceEventType | null = null;
  if (fix.inside) {
    // Inside interrupts an outside run even when the state has not changed yet.
    Object.assign(state, { outside_since: null, consecutive_outside: 0 });
    if (state.reentry_required) {
      state.consecutive_inside = Math.min(state.consecutive_inside + 1, reentryFixes);
      if (state.consecutive_inside >= reentryFixes) {
        to = 'ON_ROUTE';
        eventType = 'ROUTE_REENTRY';
        Object.assign(state, { reentry_required: false, consecutive_inside: 0 });
      }
    } else {
      to = 'ON_ROUTE';
    }
  } else {
    state.consecutive_inside = 0;
    state.consecutive_outside = Math.min(state.consecutive_outside + 1, deviationFixes);
    state.outside_since ??= fix.fixTime;
    const reached = state.consecutive_outside >= deviationFixes ||
      fix.fixTime.getTime() - state.outside_since.getTime() >= deviationWindowMs;
    if (from !== 'OFF_ROUTE' && reached) {
      to = 'OFF_ROUTE';
      // A still-outstanding deviation (latched through an UNKNOWN gap) is not reported twice.
      if (!state.reentry_required) eventType = 'ROUTE_DEVIATION';
      state.reentry_required = true;
    }
  }
  setCompliance(state, to, fix.now);
  return eventType === null ? null : { eventType, fromState: from, toState: to };
}

/** Invalid, late, ahead or route-unusable input: UNKNOWN with runs reset; the latch survives only by request. */
export function resetCompliance(state: ComplianceFields, keepLatch: boolean, now: Date): void {
  setCompliance(state, 'UNKNOWN', now);
  Object.assign(state, {
    distance_m: null, outside_since: null, consecutive_outside: 0, consecutive_inside: 0,
    reentry_required: keepLatch && state.reentry_required,
  });
}

/**
 * Freshness expiry seen at processing time: UNKNOWN now, but the runs stay so a next fix that is
 * still source-time continuous (<= 30 s) is judged on fix times, not on writer latency.
 */
export function expireCompliance(state: ComplianceFields, now: Date): void {
  setCompliance(state, 'UNKNOWN', now);
  state.distance_m = null;
}

function setCompliance(state: ComplianceFields, to: RouteCompliance, now: Date): void {
  if (state.route_compliance !== to) state.compliance_changed_at = now;
  state.route_compliance = to;
}
