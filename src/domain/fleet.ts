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

export interface DriverDirectoryEntry {
  driverId: string;
  userId: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  userStatus: 'ACTIVE' | 'DISABLED';
  emailVerified: boolean;
  operatorId: string | null;
  activeJeepneyId: string | null;
  groupIds: string[];
  createdAt: Date;
}

export interface OperatorDirectoryEntry {
  operatorId: string;
  ownerUserId: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  userStatus: 'ACTIVE' | 'DISABLED';
  driverCount: number;
  jeepneyCount: number;
  groupCount: number;
  createdAt: Date;
}

export interface PaginationResult {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

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

export function serializeDriverDirectoryEntry(driver: DriverDirectoryEntry) {
  return {
    ...driver,
    createdAt: driver.createdAt.toISOString(),
  };
}

export function serializeOperatorDirectoryEntry(operator: OperatorDirectoryEntry) {
  return {
    ...operator,
    createdAt: operator.createdAt.toISOString(),
  };
}
