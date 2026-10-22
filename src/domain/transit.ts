export type RecordStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface TransitRoute {
  id: string;
  routeCode: string;
  publicName: string;
  description: string | null;
  routeColorHex: string;
  status: RecordStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface RouteDirection {
  id: string;
  routeId: string;
  directionLabel: string;
  originName: string;
  destinationName: string;
  geometry: LineStringGeometry;
  corridorM: number;
  status: RecordStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface VehicleRouteAssignment {
  id: string;
  jeepneyId: string | null;
  groupId: string | null;
  routeDirectionId: string;
  assignedByUserId: string;
  activeFrom: Date;
  activeTo: Date | null;
}

export interface EffectiveRouteDirection {
  source: 'DIRECT' | 'GROUP';
  assignmentId: string;
  groupId: string | null;
  activeFrom: Date;
  direction: RouteDirection;
}

export interface AffectedJeepney {
  jeepneyId: string;
  plateNo: string;
  source: 'DIRECT' | 'GROUP';
  assignmentId: string;
  groupId: string | null;
}

export interface RouteAssignmentImpact {
  routeDirectionId: string;
  activeDirectAssignmentCount: number;
  activeGroupAssignmentCount: number;
  affectedJeepneyCount: number;
  affectedJeepneys: AffectedJeepney[];
}

export function serializeTransitRoute(route: TransitRoute) {
  return {
    ...route,
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
  };
}

export function serializeRouteDirection(direction: RouteDirection) {
  return {
    ...direction,
    createdAt: direction.createdAt.toISOString(),
    updatedAt: direction.updatedAt.toISOString(),
  };
}

export function serializeVehicleRouteAssignment(assignment: VehicleRouteAssignment) {
  return {
    ...assignment,
    activeFrom: assignment.activeFrom.toISOString(),
    activeTo: assignment.activeTo?.toISOString() ?? null,
  };
}

export function serializeEffectiveRouteDirection(effective: EffectiveRouteDirection) {
  return {
    ...effective,
    activeFrom: effective.activeFrom.toISOString(),
    direction: serializeRouteDirection(effective.direction),
  };
}
