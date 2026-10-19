import type {
  AuditEntry,
  AuthChallenge,
  ChallengeType,
  Role,
  SelfRegistrationRole,
  User,
  UserStatus,
} from '../domain/identity.js';

export interface CreateUserInput {
  email: string;
  passwordHash: string | null;
  displayName: string;
  role: SelfRegistrationRole;
  emailVerifiedAt?: Date | null;
}

export interface CreateChallengeInput {
  userId: string;
  email: string;
  type: ChallengeType;
  tokenHash: string;
  pendingEmail?: string | null;
  expiresAt: Date;
}

export interface CreateRefreshSessionInput {
  id: string;
  familyId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export type RefreshSessionReplacementInput = Omit<
  CreateRefreshSessionInput,
  'familyId' | 'userId'
>;

export interface ExternalIdentity {
  userId: string;
  provider: 'GOOGLE';
  providerSubject: string;
}

export interface RotateRefreshResult {
  status: 'rotated' | 'not_found' | 'reused' | 'expired';
  user?: User;
}

export interface IdentityRepository {
  createUser(input: CreateUserInput): Promise<User>;
  findUserById(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  updateProfile(userId: string, displayName: string): Promise<User>;
  updateStatus(userId: string, status: UserStatus): Promise<User>;
  verifyEmail(userId: string): Promise<User>;
  changeEmail(userId: string, email: string): Promise<User>;
  updatePassword(userId: string, passwordHash: string): Promise<User>;
  addRole(userId: string, role: Role): Promise<User>;

  createChallenge(input: CreateChallengeInput): Promise<AuthChallenge>;
  findActiveChallenge(userId: string, type: ChallengeType): Promise<AuthChallenge | null>;
  invalidateChallenge(id: string): Promise<void>;
  consumeChallenge(tokenHash: string, type: ChallengeType): Promise<AuthChallenge | null>;

  createRefreshSession(input: CreateRefreshSessionInput): Promise<void>;
  rotateRefreshSession(
    oldTokenHash: string,
    replacement: RefreshSessionReplacementInput,
  ): Promise<RotateRefreshResult>;
  revokeRefreshSession(tokenHash: string): Promise<void>;
  revokeRefreshFamily(familyId: string): Promise<void>;
  revokeAllUserSessions(userId: string): Promise<void>;

  findExternalIdentity(provider: 'GOOGLE', providerSubject: string): Promise<ExternalIdentity | null>;
  linkExternalIdentity(userId: string, provider: 'GOOGLE', providerSubject: string): Promise<void>;

  writeAudit(entry: AuditEntry): Promise<void>;
}
