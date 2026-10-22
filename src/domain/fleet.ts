export const jeepneyStatuses = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'ACTIVE',
  'INACTIVE',
  'REJECTED',
] as const;
export type JeepneyStatus = (typeof jeepneyStatuses)[number];

export interface Jeepney {
  id: string;
  operatorId: string | null;
  createdByUserId: string;
  plateNo: string;
  colorHex: string;
  description: string | null;
  status: JeepneyStatus;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FleetGroup {
  id: string;
  operatorId: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
}

export interface DriverAssignment {
  id: string;
  driverId: string;
  jeepneyId: string;
  assignedByUserId: string;
  activeFrom: Date;
  activeTo: Date | null;
}

export interface FleetGroupDriverMember {
  memberType: 'DRIVER';
  driverId: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  activeJeepneyId: string | null;
  joinedAt: Date;
}

export interface FleetGroupJeepneyMember {
  memberType: 'JEEPNEY';
  jeepneyId: string;
  plateNo: string;
  colorHex: string;
  description: string | null;
  status: JeepneyStatus;
  activeDriverId: string | null;
  joinedAt: Date;
}

export type FleetGroupMember = FleetGroupDriverMember | FleetGroupJeepneyMember;

export function serializeJeepney(jeepney: Jeepney) {
  return {
    id: jeepney.id,
    operatorId: jeepney.operatorId,
    plateNo: jeepney.plateNo,
    colorHex: jeepney.colorHex,
    description: jeepney.description,
    status: jeepney.status,
    approvedAt: jeepney.approvedAt?.toISOString() ?? null,
    createdAt: jeepney.createdAt.toISOString(),
    updatedAt: jeepney.updatedAt.toISOString(),
  };
}

export function serializeFleetGroup(group: FleetGroup) {
  return {
    id: group.id,
    operatorId: group.operatorId,
    name: group.name,
    description: group.description,
    status: group.status,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export function serializeDriverAssignment(assignment: DriverAssignment) {
  return {
    id: assignment.id,
    driverId: assignment.driverId,
    jeepneyId: assignment.jeepneyId,
    assignedByUserId: assignment.assignedByUserId,
    activeFrom: assignment.activeFrom.toISOString(),
    activeTo: assignment.activeTo?.toISOString() ?? null,
  };
}

export function serializeFleetGroupMember(member: FleetGroupMember) {
  return { ...member, joinedAt: member.joinedAt.toISOString() };
}
