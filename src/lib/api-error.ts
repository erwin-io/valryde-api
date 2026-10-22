export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'SESSION_REVOKED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'EMAIL_NOT_VERIFIED'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_CHALLENGE'
  | 'GOOGLE_SIGN_IN_UNAVAILABLE'
  | 'EMAIL_DELIVERY_UNAVAILABLE'
  | 'DRIVER_NOT_READY'
  | 'DRIVER_ALREADY_ASSOCIATED'
  | 'ROUTE_NOT_APPROVED'
  | 'ROUTE_ASSIGNMENT_CONFLICT'
  | 'VEHICLE_NOT_APPROVED'
  | 'GPS_NOT_INSTALLED'
  | 'DEVICE_MAPPING_CONFLICT'
  | 'GEOCODER_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
