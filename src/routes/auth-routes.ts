import type { FastifyPluginAsync } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import { toPublicUser } from '../domain/identity.js';
import { ApiError } from '../lib/api-error.js';
import { OpenApiTags } from '../openapi.js';
import type { IdentityRepository } from '../repositories/identity-repository.js';
import {
  EmailSchema,
  ErrorSchema,
  MessageSchema,
  PasswordSchema,
  SelfRegistrationRoleSchema,
  TokenSchema,
  UserSchema,
} from '../schemas/common.js';
import type { AuthService } from '../services/auth-service.js';

export interface AuthRoutesOptions {
  authService: AuthService;
  repository: IdentityRepository;
}

const AuthTokensSchema = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.String(),
  accessTokenExpiresIn: Type.Integer(),
  refreshTokenExpiresAt: Type.String(),
  user: UserSchema,
});

const errorResponses = {
  400: ErrorSchema,
  401: ErrorSchema,
  403: ErrorSchema,
  409: ErrorSchema,
  429: ErrorSchema,
};

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (instance, options) => {
  const fastify = instance.withTypeProvider<TypeBoxTypeProvider>();

  fastify.post(
    '/register',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: [OpenApiTags.authentication],
        operationId: 'registerUser',
        summary: 'Register a user account',
        description:
          'Public self-registration for COMMUTER, DRIVER, or OPERATOR. Email verification is required before password login.',
        body: Type.Object(
          {
            email: EmailSchema,
            password: PasswordSchema,
            displayName: Type.String({ minLength: 1, maxLength: 120 }),
            role: SelfRegistrationRoleSchema,
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ user: UserSchema, message: Type.String() }),
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const user = await options.authService.register(request.body);
      return reply.code(201).send({
        user,
        message: 'Registration accepted. Verify the email address before signing in.',
      });
    },
  );

  fastify.post(
    '/verify-email',
    {
      schema: {
        tags: [OpenApiTags.authentication],
        operationId: 'verifyEmail',
        summary: 'Verify a registered email address',
        description: 'Public token exchange that marks a newly registered email address as verified.',
        body: Type.Object({ token: TokenSchema }, { additionalProperties: false }),
        response: { 200: Type.Object({ user: UserSchema }), ...errorResponses },
      },
    },
    async (request) => ({ user: await options.authService.verifyEmail(request.body.token) }),
  );

  fastify.post(
    '/resend-verification',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        tags: [OpenApiTags.authentication],
        operationId: 'resendEmailVerification',
        summary: 'Resend email verification instructions',
        description:
          'Public, enumeration-resistant request. Eligible unverified accounts receive a replacement, time-limited verification link subject to a resend cooldown.',
        body: Type.Object({ email: EmailSchema }, { additionalProperties: false }),
        response: { 202: MessageSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      await options.authService.resendEmailVerification(request.body.email);
      return reply.code(202).send({
        message: 'If an eligible account exists, verification instructions will be sent.',
      });
    },
  );

  fastify.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: [OpenApiTags.authentication],
        operationId: 'loginUser',
        summary: 'Sign in with email and password',
        description: 'Public login for a verified, active account. Returns JWT access and rotating refresh tokens.',
        body: Type.Object(
          { email: EmailSchema, password: PasswordSchema },
          { additionalProperties: false },
        ),
        response: { 200: AuthTokensSchema, ...errorResponses },
      },
    },
    async (request) =>
      options.authService.login(
        request.body.email,
        request.body.password,
        clientContext(request.headers['user-agent'], request.ip),
      ),
  );

  fastify.post(
    '/google',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: [OpenApiTags.authentication],
        operationId: 'signInWithGoogle',
        summary: 'Sign in with Google',
        description: 'Public Google ID-token sign-in for configured OAuth client IDs and approved self-registration roles.',
        body: Type.Object(
          { idToken: Type.String({ minLength: 20 }), role: SelfRegistrationRoleSchema },
          { additionalProperties: false },
        ),
        response: { 200: AuthTokensSchema, ...errorResponses, 503: ErrorSchema },
      },
    },
    async (request) =>
      options.authService.googleSignIn(
        request.body.idToken,
        request.body.role,
        clientContext(request.headers['user-agent'], request.ip),
      ),
  );

  fastify.post(
    '/refresh',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: [OpenApiTags.authentication],
        operationId: 'refreshSession',
        summary: 'Rotate a refresh-token session',
        description: 'Public token exchange using an opaque refresh token. The consumed token is rotated and revoked.',
        body: Type.Object({ refreshToken: TokenSchema }, { additionalProperties: false }),
        response: { 200: AuthTokensSchema, ...errorResponses },
      },
    },
    async (request) =>
      options.authService.refresh(
        request.body.refreshToken,
        clientContext(request.headers['user-agent'], request.ip),
      ),
  );

  fastify.post(
    '/logout',
    {
      schema: {
        tags: [OpenApiTags.authentication],
        operationId: 'logoutSession',
        summary: 'Log out a refresh-token session',
        description: 'Revokes the supplied opaque refresh token. No JWT access token is required.',
        body: Type.Object({ refreshToken: TokenSchema }, { additionalProperties: false }),
        response: { 204: Type.Null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await options.authService.logout(request.body.refreshToken);
      return reply.code(204).send(null);
    },
  );

  fastify.post(
    '/forgot-password',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        tags: [OpenApiTags.authentication],
        operationId: 'requestPasswordReset',
        summary: 'Request password recovery',
        description: 'Public, enumeration-resistant password recovery request for an email address.',
        body: Type.Object({ email: EmailSchema }, { additionalProperties: false }),
        response: { 202: MessageSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      await options.authService.forgotPassword(request.body.email);
      return reply.code(202).send({
        message: 'If an eligible account exists, password recovery instructions will be sent.',
      });
    },
  );

  fastify.post(
    '/reset-password',
    {
      schema: {
        tags: [OpenApiTags.authentication],
        operationId: 'resetPassword',
        summary: 'Reset a password with a recovery token',
        description: 'Public recovery-token exchange that replaces the account password and invalidates prior credentials.',
        body: Type.Object(
          { token: TokenSchema, password: PasswordSchema },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await options.authService.resetPassword(request.body.token, request.body.password);
      return reply.code(204).send(null);
    },
  );

  fastify.get(
    '/me',
    {
      preHandler: (request, reply) => fastify.authenticate(request, reply),
      schema: {
        tags: [OpenApiTags.accounts],
        operationId: 'getCurrentUser',
        summary: 'Get the current user profile',
        description: 'Authenticated endpoint for any active VALRYDE role.',
        security: [{ bearerAuth: [] }],
        response: { 200: Type.Object({ user: UserSchema }), ...errorResponses },
      },
    },
    (request) => ({ user: toPublicUser(requireCurrentUser(request.currentUser)) }),
  );

  fastify.patch(
    '/me',
    {
      preHandler: (request, reply) => fastify.authenticate(request, reply),
      schema: {
        tags: [OpenApiTags.accounts],
        operationId: 'updateCurrentUser',
        summary: 'Update the current user profile',
        description: 'Authenticated endpoint for any active VALRYDE role to change its display name.',
        security: [{ bearerAuth: [] }],
        body: Type.Object(
          { displayName: Type.String({ minLength: 1, maxLength: 120 }) },
          { additionalProperties: false },
        ),
        response: { 200: Type.Object({ user: UserSchema }), ...errorResponses },
      },
    },
    async (request) => {
      const user = requireCurrentUser(request.currentUser);
      const updated = await options.repository.updateProfile(user.id, request.body.displayName.trim());
      return { user: toPublicUser(updated) };
    },
  );

  fastify.post(
    '/me/change-password',
    {
      preHandler: (request, reply) => fastify.authenticate(request, reply),
      schema: {
        tags: [OpenApiTags.accounts],
        operationId: 'changeCurrentUserPassword',
        summary: 'Change the current user password',
        description: 'Authenticated endpoint requiring the current password; prior sessions are invalidated.',
        security: [{ bearerAuth: [] }],
        body: Type.Object(
          { currentPassword: PasswordSchema, newPassword: PasswordSchema },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await options.authService.changePassword(
        requireCurrentUser(request.currentUser),
        request.body.currentPassword,
        request.body.newPassword,
      );
      return reply.code(204).send(null);
    },
  );

  fastify.post(
    '/me/change-email',
    {
      preHandler: (request, reply) => fastify.authenticate(request, reply),
      schema: {
        tags: [OpenApiTags.accounts],
        operationId: 'requestCurrentUserEmailChange',
        summary: 'Request an email-address change',
        description: 'Authenticated endpoint that sends verification for a new email address before applying it.',
        security: [{ bearerAuth: [] }],
        body: Type.Object({ email: EmailSchema }, { additionalProperties: false }),
        response: { 202: MessageSchema, ...errorResponses, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      await options.authService.requestEmailChange(
        requireCurrentUser(request.currentUser),
        request.body.email,
      );
      return reply.code(202).send({ message: 'Verify the new email address to complete the change.' });
    },
  );

  fastify.post(
    '/confirm-email-change',
    {
      schema: {
        tags: [OpenApiTags.accounts],
        operationId: 'confirmCurrentUserEmailChange',
        summary: 'Confirm an email-address change',
        description: 'Public verification-token exchange that applies a previously requested email change.',
        body: Type.Object({ token: TokenSchema }, { additionalProperties: false }),
        response: { 200: Type.Object({ user: UserSchema }), ...errorResponses },
      },
    },
    async (request) => ({ user: await options.authService.confirmEmailChange(request.body.token) }),
  );
};

function clientContext(userAgent: string | undefined, ipAddress: string) {
  return { userAgent: userAgent ?? null, ipAddress };
}

function requireCurrentUser<T>(user: T | null): T {
  if (user === null) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required');
  return user;
}
