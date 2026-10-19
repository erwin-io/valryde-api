import { randomUUID } from 'node:crypto';

import type {
  AuditEntry,
  AuthChallenge,
  ChallengeType,
  RefreshSession,
  Role,
  User,
  UserStatus,
} from '../../src/domain/identity.js';
import { ApiError } from '../../src/lib/api-error.js';
import type {
  CreateChallengeInput,
  CreateRefreshSessionInput,
  CreateUserInput,
  ExternalIdentity,
  IdentityRepository,
  RefreshSessionReplacementInput,
  RotateRefreshResult,
} from '../../src/repositories/identity-repository.js';

export class MemoryIdentityRepository implements IdentityRepository {
  readonly audits: AuditEntry[] = [];
  private readonly users = new Map<string, User>();
  private readonly challenges = new Map<string, AuthChallenge>();
  private readonly sessions = new Map<string, RefreshSession>();
  private readonly identities = new Map<string, ExternalIdentity>();

  expireChallenge(tokenHash: string): void {
    const challenge = this.challenges.get(tokenHash);
    if (challenge !== undefined) challenge.expiresAt = new Date(Date.now() - 1);
  }

  ageActiveChallenge(userId: string, type: ChallengeType, milliseconds: number): void {
    for (const challenge of this.challenges.values()) {
      if (challenge.userId === userId && challenge.type === type && challenge.consumedAt === null) {
        challenge.createdAt = new Date(Date.now() - milliseconds);
      }
    }
  }

  async createUser(input: CreateUserInput): Promise<User> {
    if (await this.findUserByEmail(input.email)) {
      throw new ApiError(409, 'CONFLICT', 'An account with this email already exists');
    }
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      status: 'ACTIVE',
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      credentialsVersion: 1,
      roles: [input.role],
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return cloneUser(user);
  }

  async findUserById(id: string): Promise<User | null> {
    const user = this.users.get(id);
    return user === undefined ? null : cloneUser(user);
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const normalized = email.toLowerCase();
    const user = [...this.users.values()].find((candidate) => candidate.email === normalized);
    return user === undefined ? null : cloneUser(user);
  }

  async listUsers(): Promise<User[]> {
    return [...this.users.values()].map(cloneUser);
  }

  async updateProfile(userId: string, displayName: string): Promise<User> {
    const user = this.requireUser(userId);
    user.displayName = displayName;
    user.updatedAt = new Date();
    return cloneUser(user);
  }

  async updateStatus(userId: string, status: UserStatus): Promise<User> {
    const user = this.requireUser(userId);
    user.status = status;
    user.credentialsVersion += 1;
    user.updatedAt = new Date();
    if (status === 'DISABLED') await this.revokeAllUserSessions(userId);
    return cloneUser(user);
  }

  async verifyEmail(userId: string): Promise<User> {
    const user = this.requireUser(userId);
    user.emailVerifiedAt ??= new Date();
    user.updatedAt = new Date();
    return cloneUser(user);
  }

  async changeEmail(userId: string, email: string): Promise<User> {
    if (await this.findUserByEmail(email)) throw new ApiError(409, 'CONFLICT', 'Email is already in use');
    const user = this.requireUser(userId);
    user.email = email.toLowerCase();
    user.emailVerifiedAt = new Date();
    user.credentialsVersion += 1;
    user.updatedAt = new Date();
    await this.revokeAllUserSessions(userId);
    return cloneUser(user);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<User> {
    const user = this.requireUser(userId);
    user.passwordHash = passwordHash;
    user.credentialsVersion += 1;
    user.updatedAt = new Date();
    await this.revokeAllUserSessions(userId);
    return cloneUser(user);
  }

  async addRole(userId: string, role: Role): Promise<User> {
    const user = this.requireUser(userId);
    if (!user.roles.includes(role)) user.roles.push(role);
    return cloneUser(user);
  }

  async createChallenge(input: CreateChallengeInput): Promise<AuthChallenge> {
    for (const challenge of this.challenges.values()) {
      if (challenge.userId === input.userId && challenge.type === input.type && challenge.consumedAt === null) {
        challenge.consumedAt = new Date();
      }
    }
    const challenge: AuthChallenge = {
      id: randomUUID(),
      userId: input.userId,
      email: input.email,
      type: input.type,
      tokenHash: input.tokenHash,
      pendingEmail: input.pendingEmail ?? null,
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdAt: new Date(),
    };
    this.challenges.set(challenge.tokenHash, challenge);
    return { ...challenge };
  }

  async findActiveChallenge(userId: string, type: ChallengeType): Promise<AuthChallenge | null> {
    const matches = [...this.challenges.values()]
      .filter((item) => item.userId === userId && item.type === type && item.consumedAt === null && item.expiresAt.getTime() > Date.now())
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return matches[0] === undefined ? null : { ...matches[0] };
  }

  async invalidateChallenge(id: string): Promise<void> {
    for (const challenge of this.challenges.values()) {
      if (challenge.id === id) challenge.consumedAt ??= new Date();
    }
  }

  async consumeChallenge(tokenHash: string, type: ChallengeType): Promise<AuthChallenge | null> {
    const challenge = this.challenges.get(tokenHash);
    if (
      challenge === undefined ||
      challenge.type !== type ||
      challenge.consumedAt !== null ||
      challenge.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }
    challenge.consumedAt = new Date();
    return { ...challenge };
  }

  async createRefreshSession(input: CreateRefreshSessionInput): Promise<void> {
    this.sessions.set(input.tokenHash, { ...input, revokedAt: null, replacedById: null });
  }

  async rotateRefreshSession(
    oldTokenHash: string,
    replacement: RefreshSessionReplacementInput,
  ): Promise<RotateRefreshResult> {
    const current = this.sessions.get(oldTokenHash);
    if (current === undefined) return { status: 'not_found' };
    if (current.revokedAt !== null) {
      await this.revokeRefreshFamily(current.familyId);
      return { status: 'reused' };
    }
    if (current.expiresAt.getTime() <= Date.now()) {
      current.revokedAt = new Date();
      return { status: 'expired' };
    }
    const next: RefreshSession = {
      ...replacement,
      familyId: current.familyId,
      userId: current.userId,
      revokedAt: null,
      replacedById: null,
    };
    this.sessions.set(next.tokenHash, next);
    current.revokedAt = new Date();
    current.replacedById = next.id;
    const user = await this.findUserById(current.userId);
    return user === null ? { status: 'not_found' } : { status: 'rotated', user };
  }

  async revokeRefreshSession(tokenHash: string): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session !== undefined) session.revokedAt ??= new Date();
  }

  async revokeRefreshFamily(familyId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.familyId === familyId) session.revokedAt ??= new Date();
    }
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) session.revokedAt ??= new Date();
    }
  }

  async findExternalIdentity(
    provider: 'GOOGLE',
    providerSubject: string,
  ): Promise<ExternalIdentity | null> {
    return this.identities.get(`${provider}:${providerSubject}`) ?? null;
  }

  async linkExternalIdentity(
    userId: string,
    provider: 'GOOGLE',
    providerSubject: string,
  ): Promise<void> {
    this.identities.set(`${provider}:${providerSubject}`, { userId, provider, providerSubject });
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    this.audits.push(entry);
  }

  private requireUser(id: string): User {
    const user = this.users.get(id);
    if (user === undefined) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    return user;
  }
}

function cloneUser(user: User): User {
  return { ...user, roles: [...user.roles] };
}
