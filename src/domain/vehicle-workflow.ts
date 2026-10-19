export type VehicleApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type GpsSetupStatus = 'PENDING' | 'APPROVED' | 'SCHEDULED' | 'INSTALLED' | 'REJECTED';
export type GpsVerificationStatus = 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'FAILED';

export interface VehicleApplication {
  id: string;
  jeepneyId: string;
  submittedByUserId: string;
  status: VehicleApplicationStatus;
  applicantNotes: string | null;
  reviewNotes: string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GpsSetupRequest {
  id: string;
  vehicleApplicationId: string;
  jeepneyId: string;
  requestedByUserId: string;
  status: GpsSetupStatus;
  verificationStatus: GpsVerificationStatus;
  scheduledAt: Date | null;
  installedAt: Date | null;
  rejectedReason: string | null;
  verificationChecks: Record<string, unknown>;
  verifiedByUserId: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceMapping {
  id: string;
  gpsSetupRequestId: string;
  gpsDeviceId: string;
  jeepneyId: string;
  imei: string;
  serialNumber: string;
  traccarUniqueId: string;
  mappedAt: Date;
}

export function serializeVehicleApplication(application: VehicleApplication) {
  return {
    ...application,
    reviewedAt: application.reviewedAt?.toISOString() ?? null,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
  };
}

export function serializeGpsSetupRequest(request: GpsSetupRequest) {
  return {
    ...request,
    scheduledAt: request.scheduledAt?.toISOString() ?? null,
    installedAt: request.installedAt?.toISOString() ?? null,
    verifiedAt: request.verifiedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

export function serializeDeviceMapping(mapping: DeviceMapping) {
  return { ...mapping, mappedAt: mapping.mappedAt.toISOString() };
}
