export const roles = ['COMMUTER', 'DRIVER', 'OPERATOR', 'ADMIN'] as const;
export type Role = (typeof roles)[number];
export type SelfRegistrationRole = Exclude<Role, 'ADMIN'>;

export const userStatuses = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof userStatuses)[number];

export interface User {
  id: string;
  email: string;
  passwordHash: string | null;
  displayName: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  credentialsVersion: number;
  roles: Role[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  emailVerified: boolean;
  roles: Role[];
  createdAt: string;
  updatedAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    roles: user.roles,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export const challengeTypes = ['VERIFY_EMAIL', 'VERIFY_EMAIL_CHANGE', 'RESET_PASSWORD'] as const;
export type ChallengeType = (typeof challengeTypes)[number];

export interface AuthChallenge {
  id: string;
  userId: string;
  email: string;
  type: ChallengeType;
  tokenHash: string;
  pendingEmail: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface RefreshSession {
  id: string;
  familyId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}
