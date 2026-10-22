import { describe, expect, it, vi } from 'vitest';

import type { Jeepney } from '../src/domain/fleet.js';
import type { Role, User } from '../src/domain/identity.js';
import { PgTrackingMappingRepository, TrackingHistoryService } from '../src/tracking/tracking-history-service.js';

const range = { from: '2026-10-19T00:00:00Z', to: '2026-10-19T01:00:00Z' };
function actor(role: Role): User {
  return {
    id: 'user', email: 'test@example.test', displayName: 'Test', passwordHash: null,
    status: 'ACTIVE', emailVerifiedAt: new Date(), credentialsVersion: 1,
    roles: [role], createdAt: new Date(), updatedAt: new Date(),
  };
}
function fixture() {
  const fleet = { listJeepneys: vi.fn<(actor: User) => Promise<Jeepney[]>>().mockResolvedValue([]) };
  const mappings = { uniqueIdForJeepney: vi.fn<(id: string) => Promise<string | null>>().mockResolvedValue('tracker-7') };
  const traccar = {
    devices: vi.fn().mockResolvedValue([{ id: 7, uniqueId: 'tracker-7', status: 'online' }]),
    history: vi.fn().mockResolvedValue([{
      id: 10, deviceId: 7, valid: true, latitude: 10.3, longitude: 123.9, speed: 10, course: 90,
      fixTime: range.from, deviceTime: range.from, serverTime: range.from, attributes: { secret: 'private' },
    }]),
    events: vi.fn().mockResolvedValue([{
      id: 11, deviceId: 7, type: 'deviceMoving', eventTime: range.from, attributes: { secret: 'private' },
    }]),
  };
  return { fleet, mappings, traccar, service: new TrackingHistoryService(fleet, mappings, traccar) };
}
function permit(f: ReturnType<typeof fixture>) {
  f.fleet.listJeepneys.mockResolvedValue([{
    id: 'jeepney', operatorId: 'operator', createdByUserId: 'owner', plateNo: 'TEST-1', colorHex: '#FFFFFF',
    description: null, status: 'ACTIVE', approvedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  }]);
}

describe('authorized tracking history integration boundary', () => {
  it.each(['DRIVER', 'OPERATOR', 'COMMUTER'] as const)('denies unauthorized %s before mapping/provider access', async (role) => {
    const f = fixture();
    await expect(f.service.history(actor(role), 'other', range)).rejects.toMatchObject({ statusCode: 403 });
    await expect(f.service.events(actor(role), 'other', range)).rejects.toMatchObject({ statusCode: 403 });
    expect(f.mappings.uniqueIdForJeepney).not.toHaveBeenCalled();
    expect(f.traccar.devices).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'OPERATOR', 'DRIVER'] as const)('reuses Agent A fleet scope for %s and removes internal identifiers', async (role) => {
    const f = fixture(); permit(f);
    const user = actor(role);
    expect(await f.service.history(user, 'jeepney', range)).toEqual([{
      jeepneyId: 'jeepney', latitude: 10.3, longitude: 123.9, speedKph: 18.52, heading: 90,
      fixTime: range.from, deviceTime: range.from, serverTime: range.from,
    }]);
    expect(f.fleet.listJeepneys).toHaveBeenCalledWith(user);
    expect(f.traccar.devices).toHaveBeenCalledWith('tracker-7');
    expect(f.traccar.history).toHaveBeenCalledWith(7, range);
    expect(await f.service.events(user, 'jeepney', range)).toEqual([{
      jeepneyId: 'jeepney', source: 'TRACCAR', type: 'deviceMoving', occurredAt: range.from,
    }]);
  });

  it('denies disabled users even with platform role', async () => {
    const f = fixture(); permit(f);
    await expect(f.service.history({ ...actor('ADMIN'), status: 'DISABLED' }, 'jeepney', range))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(f.fleet.listJeepneys).not.toHaveBeenCalled();
  });

  it('returns empty data for missing verified mappings/devices/history', async () => {
    const f = fixture(); permit(f);
    f.mappings.uniqueIdForJeepney.mockResolvedValueOnce(null);
    expect(await f.service.history(actor('ADMIN'), 'jeepney', range)).toEqual([]);
    expect(f.traccar.devices).not.toHaveBeenCalled();
    f.traccar.devices.mockResolvedValueOnce([]);
    expect(await f.service.events(actor('ADMIN'), 'jeepney', range)).toEqual([]);
    f.traccar.history.mockResolvedValueOnce([]);
    expect(await f.service.history(actor('ADMIN'), 'jeepney', range)).toEqual([]);
  });

  it('rejects invalid time ranges before upstream lookup', async () => {
    const f = fixture(); permit(f);
    await expect(f.service.history(actor('ADMIN'), 'jeepney', { from: range.to, to: range.from }))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(f.mappings.uniqueIdForJeepney).not.toHaveBeenCalled();
  });

  it('fails closed for unexpected provider device identities or cross-device records', async () => {
    const f = fixture(); permit(f);
    f.traccar.devices.mockResolvedValueOnce([{ id: 99, uniqueId: 'other', status: 'online' }]);
    await expect(f.service.history(actor('ADMIN'), 'jeepney', range)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    f.traccar.history.mockResolvedValueOnce([{ deviceId: 99 }]);
    await expect(f.service.history(actor('ADMIN'), 'jeepney', range)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    f.traccar.events.mockResolvedValueOnce([{ deviceId: 99 }]);
    await expect(f.service.events(actor('ADMIN'), 'jeepney', range)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('filters invalid GPS fixes and records outside the requested interval', async () => {
    const f = fixture(); permit(f);
    f.traccar.history.mockResolvedValueOnce([
      { deviceId: 7, valid: false, fixTime: range.from },
      { deviceId: 7, valid: true, fixTime: '2020-01-01T00:00:00Z' },
    ]);
    f.traccar.events.mockResolvedValueOnce([{ deviceId: 7, eventTime: '2020-01-01T00:00:00Z' }]);
    expect(await f.service.history(actor('ADMIN'), 'jeepney', range)).toEqual([]);
    expect(await f.service.events(actor('ADMIN'), 'jeepney', range)).toEqual([]);
  });

  it('keeps mapping lookup parameterized and handles no mapped row', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ traccar_unique_id: 'tracker-7' }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PgTrackingMappingRepository({ query });
    expect(await repository.uniqueIdForJeepney('jeepney')).toBe('tracker-7');
    expect(await repository.uniqueIdForJeepney('unknown')).toBeNull();
    expect(query.mock.calls[0]?.[1]).toEqual(['jeepney']);
  });
  it('rejects ambiguous duplicate provider devices even when uniqueIds agree', async () => {
    const f = fixture(); permit(f);
    f.traccar.devices.mockResolvedValueOnce([
      { id: 7, uniqueId: 'tracker-7', status: 'online' },
      { id: 8, uniqueId: 'tracker-7', status: 'online' },
    ]);
    await expect(f.service.history(actor('DRIVER'), 'jeepney', range)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(f.traccar.history).not.toHaveBeenCalled();
  });

  it('reauthorizes every read instead of retaining a revoked fleet grant', async () => {
    const f = fixture(); permit(f); const user = actor('OPERATOR');
    await f.service.history(user, 'jeepney', range);
    f.fleet.listJeepneys.mockResolvedValueOnce([]);
    await expect(f.service.events(user, 'jeepney', range)).rejects.toMatchObject({ statusCode: 403 });
    expect(f.mappings.uniqueIdForJeepney).toHaveBeenCalledTimes(1);
    expect(f.traccar.events).not.toHaveBeenCalled();
  });

});
