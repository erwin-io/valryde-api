import { describe, expect, it } from 'vitest';

import {
  applyQualifyingFix, type ComplianceFields, expireCompliance, resetCompliance,
} from '../src/tracking/route-compliance.js';

const t0 = Date.parse('2026-10-23T00:00:00.000Z');
const blank = (): ComplianceFields => ({
  route_compliance: 'UNKNOWN', distance_m: null, outside_since: null, consecutive_outside: 0,
  consecutive_inside: 0, reentry_required: false, compliance_changed_at: null,
});

// Feeds fixes with the given offsets (s) and sides; consecutive fixes <= 30 s apart are continuous.
function run(state: ComplianceFields, fixes: Array<[number, 'in' | 'out']>, lastAt?: number) {
  let previous = lastAt;
  return fixes.map(([seconds, side]) => {
    const at = t0 + seconds * 1_000;
    const continuous = previous !== undefined && at - previous <= 30_000;
    previous = at;
    return applyQualifyingFix(state, {
      inside: side === 'in', distanceM: side === 'in' ? 10 : 250, fixTime: new Date(at), continuous, now: new Date(at),
    });
  });
}

describe('Stage 13b B3 route compliance state machine (frozen thresholds)', () => {
  it('B13B-01: an initial inside fix bootstraps ON_ROUTE with no event', () => {
    const state = blank();
    expect(run(state, [[0, 'in']])).toEqual([null]);
    expect(state).toMatchObject({ route_compliance: 'ON_ROUTE', reentry_required: false, distance_m: 10 });
  });

  it('B13B-05: three consecutive outside fixes deviate once, on the third', () => {
    const state = blank();
    const events = run(state, [[0, 'in'], [10, 'out'], [20, 'out'], [25, 'out'], [27, 'out']]);
    expect(events.slice(0, 3)).toEqual([null, null, null]);
    expect(events[3]).toEqual({ eventType: 'ROUTE_DEVIATION', fromState: 'ON_ROUTE', toState: 'OFF_ROUTE' });
    expect(events[4]).toBeNull();
    expect(state).toMatchObject({ route_compliance: 'OFF_ROUTE', reentry_required: true, consecutive_outside: 3 });
  });

  it('B13B-04: two outside fixes exactly 30 s apart deviate; 30.001 s apart is a broken run', () => {
    const state = blank();
    expect(run(state, [[0, 'out'], [30, 'out']])[1]).toEqual({
      eventType: 'ROUTE_DEVIATION', fromState: 'UNKNOWN', toState: 'OFF_ROUTE',
    });
    const gap = blank();
    expect(run(gap, [[0, 'out'], [30.001, 'out']])).toEqual([null, null]);
    expect(gap).toMatchObject({ route_compliance: 'UNKNOWN', consecutive_outside: 1 });
  });

  it('B13B-06/09: a lone outside point is debounced and inside interrupts the run', () => {
    const state = blank();
    expect(run(state, [[0, 'out']])).toEqual([null]);
    expect(state).toMatchObject({ route_compliance: 'UNKNOWN', consecutive_outside: 1 });
    expect(run(state, [[5, 'in'], [10, 'out'], [15, 'out'], [20, 'in']], t0)).toEqual([null, null, null, null]);
    expect(state).toMatchObject({ route_compliance: 'ON_ROUTE', consecutive_outside: 0, outside_since: null });
  });

  it('B13B-07: OFF_ROUTE needs two consecutive inside fixes to re-enter, and outside resets that count', () => {
    const state = blank();
    run(state, [[0, 'out'], [5, 'out'], [10, 'out']]);
    expect(run(state, [[12, 'in'], [14, 'out'], [16, 'in']], t0 + 10_000)).toEqual([null, null, null]);
    expect(state).toMatchObject({ route_compliance: 'OFF_ROUTE', consecutive_inside: 1 });
    expect(run(state, [[18, 'in']], t0 + 16_000)).toEqual([
      { eventType: 'ROUTE_REENTRY', fromState: 'OFF_ROUTE', toState: 'ON_ROUTE' },
    ]);
    expect(state).toMatchObject({ route_compliance: 'ON_ROUTE', reentry_required: false, consecutive_inside: 0 });
  });

  it('B13B-08: invalid/stale interrupts to UNKNOWN but keeps the latch; no one-fix bypass, no duplicate deviation', () => {
    const state = blank();
    run(state, [[0, 'out'], [5, 'out'], [10, 'out']]);
    resetCompliance(state, true, new Date(t0 + 12_000));
    expect(state).toMatchObject({ route_compliance: 'UNKNOWN', reentry_required: true, consecutive_outside: 0 });
    expect(run(state, [[14, 'in']], t0 + 12_000)).toEqual([null]);
    expect(state.route_compliance).toBe('UNKNOWN');
    // Back outside while the deviation is still outstanding: OFF_ROUTE again, but not reported twice.
    expect(run(state, [[16, 'out'], [18, 'out'], [20, 'out']], t0 + 14_000)).toEqual([null, null, null]);
    expect(state.route_compliance).toBe('OFF_ROUTE');
    resetCompliance(state, true, new Date(t0 + 22_000));
    expect(run(state, [[24, 'in'], [26, 'in']], t0 + 22_000)).toEqual([
      null, { eventType: 'ROUTE_REENTRY', fromState: 'UNKNOWN', toState: 'ON_ROUTE' },
    ]);
  });

  it('B13B-10: an invalid sample between outside fixes restarts the run', () => {
    const state = blank();
    run(state, [[0, 'in'], [5, 'out'], [10, 'out']]);
    resetCompliance(state, true, new Date(t0 + 12_000));
    expect(run(state, [[14, 'out'], [16, 'out']], t0 + 12_000)).toEqual([null, null]);
    expect(state).toMatchObject({ route_compliance: 'UNKNOWN', consecutive_outside: 2 });
  });

  it('expiry seen late keeps the source-time run, so writer latency does not decide the verdict', () => {
    const state = blank();
    run(state, [[0, 'in'], [5, 'out']]);
    expireCompliance(state, new Date(t0 + 35_500));
    expect(state).toMatchObject({ route_compliance: 'UNKNOWN', consecutive_outside: 1, distance_m: null });
    expect(run(state, [[35, 'out']], t0 + 5_000)).toEqual([
      { eventType: 'ROUTE_DEVIATION', fromState: 'UNKNOWN', toState: 'OFF_ROUTE' },
    ]);
  });

  it('a context reset clears the latch so the new context bootstraps without a re-entry event', () => {
    const state = blank();
    run(state, [[0, 'out'], [5, 'out'], [10, 'out']]);
    resetCompliance(state, false, new Date(t0 + 12_000));
    expect(run(state, [[14, 'in']])).toEqual([null]);
    expect(state).toMatchObject({ route_compliance: 'ON_ROUTE', reentry_required: false });
  });
});
