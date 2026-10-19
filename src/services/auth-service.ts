import { randomUUID } from 'node:crypto';

import argon2 from 'argon2';

import type { AppConfig } from '../config.js';
import type { ChallengeType, SelfRegistrationRole, User } from '../domain/identity.js';
import { toPublicUser } from '../domain/identity.js';
import { ApiError } from '../lib/api-error.js';
import { randomToken, tokenHash } from '../lib/crypto.js';
import type { IdentityRepository } from '../repositories/identity-repository.js';
import type { GoogleIdentityService } from './google-identity-service.js';
import type { NotificationService } from './notification-service.js';

export interface ClientContext {
  userAgent: string | null;
  ipAddress: string | null;
}

export interface AccessClaims {
  sub: string;
  roles: User['roles'];
  ver: number;
  type: 'access';
}

export type AccessTokenSigner = (claims: AccessClaims) => string;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
  user: ReturnType<typeof toPublicUser>;
}

export class AuthService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly config: AppConfig,
    private readonly notifications: NotificationService,
    private readonly googleIdentity: GoogleIdentityService,
    private readonly signAccessToken: AccessTokenSigner,
    private readonly dummyPasswordHash: string,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
    role: SelfRegistrationRole;
  }): Promise<ReturnType<typeof toPublicUser>> {
    const email = normalizeEmail(input.email);
    validatePassword(input.password);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await this.repository.createUser({
      email,
      passwordHash,
      displayName: input.displayName.trim(),
      role: input.role,
    });
    await this.repository.writeAudit({
      actorUserId: user.id,
      action: 'USER_REGISTERED',
      entityType: 'USER',
      entityId: user.id,
      metadata: { role: input.role },
    });
    await this.issueChallenge(user, 'VERIFY_EMAIL', false, true);
    return toPublicUser(user);
  }

  async verifyEmail(token: string): Promise<ReturnType<typeof toPublicUser>> {
    const challenge = await this.consumeChallenge(token, 'VERIFY_EMAIL');
    const user = await this.repository.verifyEmail(challenge.userId);
    await this.repository.writeAudit({
      actorUserId: user.id,
      action: 'EMAIL_VERIFIED',
      entityType: 'USER',
      entityId: user.id,
    });
    return toPublicUser(user);
  }

  async login(email: string, password: string, context: ClientContext): Promise<AuthTokens> {
    const user = await this.repository.findUserByEmail(normalizeEmail(email));
    const candidateHash = user?.passwordHash ?? this.dummyPasswordHash;
    const passwordValid = await argon2.verify(candidateHash, password).catch(() => false);
    if (user === null || user.passwordHash === null || !passwordValid) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    this.assertCanSignIn(user);
    return this.createSession(user, context);
  }

  async googleSignIn(
    idToken: string,
    requestedRole: SelfRegistrationRole,
    context: ClientContext,
  ): Promise<AuthTokens> {
    const identity = await this.googleIdentity.verifyIdToken(idToken);
    const linked = await this.repository.findExternalIdentity('GOOGLE', identity.subject);
    let user = linked === null ? null : await this.repository.findUserById(linked.userId);

    if (user === null) {
      user = await this.repository.findUserByEmail(identity.email);
      if (user === null) {
        user = await this.repository.createUser({
          email: identity.email,
          passwordHash: null,
          displayName: identity.displayName,
          role: requestedRole,
          emailVerifiedAt: new Date(),
        });
      } else if (user.emailVerifiedAt === null) {
        user = await this.repository.verifyEmail(user.id);
      }
      await this.repository.linkExternalIdentity(user.id, 'GOOGLE', identity.subject);
      await this.repository.writeAudit({
        actorUserId: user.id,
        action: 'GOOGLE_IDENTITY_LINKED',
        entityType: 'USER',
        entityId: user.id,
      });
    }

    this.assertCanSignIn(user);
    return this.createSession(user, context);
  }

  async refresh(refreshToken: string, context: ClientContext): Promise<AuthTokens> {
    const replacementToken = randomToken();
    const replacementId = randomUUID();
    const expiresAt = this.refreshExpiry();
    const result = await this.repository.rotateRefreshSession(tokenHash(refreshToken), {
      id: replacementId,
      tokenHash: tokenHash(replacementToken),
      expiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });
    if (result.status !== 'rotated' || result.user === undefined) {
      throw new ApiError(401, 'SESSION_REVOKED', 'Refresh session is invalid or revoked');
    }
    this.assertCanSignIn(result.user);
    return this.tokens(result.user, replacementToken, expiresAt);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.repository.revokeRefreshSession(tokenHash(refreshToken));
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.repository.findUserByEmail(normalizeEmail(email));
    if (user !== null && user.status === 'ACTIVE') {
      await this.issueChallenge(user, 'RESET_PASSWORD', true, true);
    }
  }

  async resendEmailVerification(email: string): Promise<void> {
    const user = await this.repository.findUserByEmail(normalizeEmail(email));
    if (user !== null && user.status === 'ACTIVE' && user.emailVerifiedAt === null) {
      await this.issueChallenge(user, 'VERIFY_EMAIL', true, true);
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    validatePassword(password);
    const challenge = await this.consumeChallenge(token, 'RESET_PASSWORD');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.repository.updatePassword(challenge.userId, passwordHash);
    await this.repository.writeAudit({
      actorUserId: challenge.userId,
      action: 'PASSWORD_RESET',
      entityType: 'USER',
      entityId: challenge.userId,
    });
  }

  async changePassword(user: User, currentPassword: string, newPassword: string): Promise<void> {
    validatePassword(newPassword);
    if (user.passwordHash === null || !(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.repository.updatePassword(user.id, passwordHash);
    await this.repository.writeAudit({
      actorUserId: user.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'USER',
      entityId: user.id,
    });
  }

  async requestEmailChange(user: User, newEmail: string): Promise<void> {
    const email = normalizeEmail(newEmail);
    if (email === user.email.toLowerCase()) {
      throw new ApiError(409, 'CONFLICT', 'New email must differ from the current email');
    }
    if ((await this.repository.findUserByEmail(email)) !== null) {
      throw new ApiError(409, 'CONFLICT', 'Email is already in use');
    }
    const delivered = await this.issueChallenge(
      { ...user, email },
      'VERIFY_EMAIL_CHANGE',
      true,
      false,
      email,
    );
    if (!delivered) {
      throw new ApiError(503, 'EMAIL_DELIVERY_UNAVAILABLE', 'Email delivery is temporarily unavailable');
    }
  }

  async confirmEmailChange(token: string): Promise<ReturnType<typeof toPublicUser>> {
    const challenge = await this.consumeChallenge(token, 'VERIFY_EMAIL_CHANGE');
    if (challenge.pendingEmail === null) {
      throw new ApiError(400, 'INVALID_CHALLENGE', 'Email-change challenge is invalid');
    }
    const user = await this.repository.changeEmail(challenge.userId, challenge.pendingEmail);
    await this.repository.writeAudit({
      actorUserId: user.id,
      action: 'EMAIL_CHANGED',
      entityType: 'USER',
      entityId: user.id,
    });
    return toPublicUser(user);
  }

  private async createSession(user: User, context: ClientContext): Promise<AuthTokens> {
    const refreshToken = randomToken();
    const expiresAt = this.refreshExpiry();
    await this.repository.createRefreshSession({
      id: randomUUID(),
      familyId: randomUUID(),
      userId: user.id,
      tokenHash: tokenHash(refreshToken),
      expiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });
    return this.tokens(user, refreshToken, expiresAt);
  }

  private tokens(user: User, refreshToken: string, refreshExpiry: Date): AuthTokens {
    return {
      accessToken: this.signAccessToken({
        sub: user.id,
        roles: user.roles,
        ver: user.credentialsVersion,
        type: 'access',
      }),
      refreshToken,
      accessTokenExpiresIn: this.config.accessTokenTtlSeconds,
      refreshTokenExpiresAt: refreshExpiry.toISOString(),
      user: toPublicUser(user),
    };
  }

  private async issueChallenge(
    user: User,
    type: ChallengeType,
    respectCooldown: boolean,
    suppressDeliveryFailure: boolean,
    pendingEmail: string | null = null,
  ): Promise<boolean> {
    if (respectCooldown) {
      const active = await this.repository.findActiveChallenge(user.id, type);
      if (
        active !== null &&
        Date.now() - active.createdAt.getTime() < this.config.authResendCooldownSeconds * 1_000
      ) {
        return true;
      }
    }
    const token = randomToken();
    const challenge = await this.repository.createChallenge({
      userId: user.id,
      email: user.email,
      type,
      tokenHash: tokenHash(token),
      pendingEmail,
      expiresAt: this.challengeExpiry(),
    });
    try {
      await this.notifications.sendAuthChallenge({ type, email: user.email, token });
      return true;
    } catch {
      await this.repository.invalidateChallenge(challenge.id);
      await this.repository.writeAudit({
        actorUserId: user.id,
        action: 'AUTH_EMAIL_DELIVERY_FAILED',
        entityType: 'AUTH_CHALLENGE',
        entityId: challenge.id,
        metadata: { type },
      });
      void suppressDeliveryFailure;
      return false;
    }
  }

  private async consumeChallenge(token: string, type: ChallengeType) {
    const challenge = await this.repository.consumeChallenge(tokenHash(token), type);
    if (challenge === null) {
      throw new ApiError(400, 'INVALID_CHALLENGE', 'Challenge is invalid, expired, or already used');
    }
    return challenge;
  }

  private assertCanSignIn(user: User): void {
    if (user.status !== 'ACTIVE') throw new ApiError(403, 'FORBIDDEN', 'Account is disabled');
    if (user.emailVerifiedAt === null) {
      throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Email verification is required');
    }
  }

  private challengeExpiry(): Date {
    return new Date(Date.now() + this.config.authChallengeTtlMinutes * 60_000);
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.refreshTokenTtlDays * 86_400_000);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Password must contain 12 to 128 characters');
  }
}
