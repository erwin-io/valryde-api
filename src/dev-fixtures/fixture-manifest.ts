import type { Role } from '../domain/identity.js';

export interface FixtureAccount {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
}

export interface DevelopmentFixtureManifest {
  marker: string;
  accounts: {
    commuter: FixtureAccount;
    driverA: FixtureAccount;
    operatorA: FixtureAccount;
    admin: FixtureAccount;
    dualRole: FixtureAccount;
    driverB: FixtureAccount;
    operatorB: FixtureAccount;
  };
  operators: { operatorA: string; operatorB: string; dualRole: string };
  drivers: { driverA: string; driverB: string; dualRole: string };
  routes: { routeA: string; routeB: string };
  directions: { routeAOutbound: string; routeAInbound: string; routeBOutbound: string };
  jeepneys: {
    activeA: string;
    pendingA: string;
    noAssignmentA: string;
    conflictA: string;
    operatorB: string;
  };
  groups: { primaryA: string; conflictingA: string; operatorB: string };
  driverAssignments: { driverA: string; driverB: string };
  routeAssignments: { directA: string; primaryGroupA: string; conflictingGroupA: string; groupB: string };
  applications: { activeA: string; pendingA: string; noAssignmentA: string; operatorB: string };
  gpsRequests: { installedA: string; pendingA: string; rejectedB: string };
  gpsDevice: string;
  deviceMapping: string;
  scenarios: {
    success: string;
    failure: string;
    noAssignment: string;
    ownershipDenied: string;
    routeConflict: string;
  };
}

export const developmentFixtureManifest = createDevelopmentFixtureManifest('d', 'dev');

export function createDevelopmentFixtureManifest(
  namespace: 'd' | 'e',
  emailPrefix: string,
): DevelopmentFixtureManifest {
  const id = (category: string, sequence: number): string =>
    `${namespace}${category}000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
  const account = (
    sequence: number,
    key: string,
    displayName: string,
    roles: Role[],
  ): FixtureAccount => ({
    id: id('1', sequence),
    email: `${emailPrefix}.${key}@valryde.test`,
    displayName: `[VALRYDE DEV FIXTURE] ${displayName}`,
    roles,
  });

  return {
    marker: `[VALRYDE DEV FIXTURE:${namespace}]`,
    accounts: {
      commuter: account(1, 'commuter', 'Commuter', ['COMMUTER']),
      driverA: account(2, 'driver-a', 'Driver A', ['DRIVER']),
      operatorA: account(3, 'operator-a', 'Operator A', ['OPERATOR']),
      admin: account(4, 'admin', 'Admin', ['ADMIN']),
      dualRole: account(5, 'driver-operator', 'Driver and Operator', ['DRIVER', 'OPERATOR']),
      driverB: account(6, 'driver-b', 'Driver B', ['DRIVER']),
      operatorB: account(7, 'operator-b', 'Operator B', ['OPERATOR']),
    },
    operators: {
      operatorA: id('2', 1),
      operatorB: id('2', 2),
      dualRole: id('2', 3),
    },
    drivers: {
      driverA: id('3', 1),
      driverB: id('3', 2),
      dualRole: id('3', 3),
    },
    routes: { routeA: id('4', 1), routeB: id('4', 2) },
    directions: {
      routeAOutbound: id('5', 1),
      routeAInbound: id('5', 2),
      routeBOutbound: id('5', 3),
    },
    jeepneys: {
      activeA: id('6', 1),
      pendingA: id('6', 2),
      noAssignmentA: id('6', 3),
      conflictA: id('6', 4),
      operatorB: id('6', 5),
    },
    groups: { primaryA: id('7', 1), conflictingA: id('7', 2), operatorB: id('7', 3) },
    driverAssignments: { driverA: id('8', 1), driverB: id('8', 2) },
    routeAssignments: {
      directA: id('8', 101),
      primaryGroupA: id('8', 102),
      conflictingGroupA: id('8', 103),
      groupB: id('8', 104),
    },
    applications: {
      activeA: id('9', 1),
      pendingA: id('9', 2),
      noAssignmentA: id('9', 3),
      operatorB: id('9', 4),
    },
    gpsRequests: {
      installedA: id('a', 1),
      pendingA: id('a', 2),
      rejectedB: id('a', 3),
    },
    gpsDevice: id('b', 1),
    deviceMapping: id('c', 1),
    scenarios: {
      success:
        'Operator A owns an ACTIVE jeepney with Driver A, a direct route, an approved application, and a synthetic verified GPS mapping.',
      failure:
        'Operator B has an approved vehicle application with a rejected GPS setup request.',
      noAssignment:
        'Operator A owns an approved jeepney with a pending GPS request but no active Driver or route assignment.',
      ownershipDenied:
        'Operator A must receive FORBIDDEN when attempting to assign Driver B or mutate Operator B resources.',
      routeConflict:
        'The conflict jeepney belongs to Primary A; adding it to Conflicting A must return ROUTE_ASSIGNMENT_CONFLICT because both groups have active routes.',
    },
  };
}

export function fixtureIds(manifest: DevelopmentFixtureManifest): string[] {
  return [
    ...Object.values(manifest.accounts).map(({ id }) => id),
    ...Object.values(manifest.operators),
    ...Object.values(manifest.drivers),
    ...Object.values(manifest.routes),
    ...Object.values(manifest.directions),
    ...Object.values(manifest.jeepneys),
    ...Object.values(manifest.groups),
    ...Object.values(manifest.driverAssignments),
    ...Object.values(manifest.routeAssignments),
    ...Object.values(manifest.applications),
    ...Object.values(manifest.gpsRequests),
    manifest.gpsDevice,
    manifest.deviceMapping,
  ];
}
