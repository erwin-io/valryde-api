import { Type } from 'typebox';

export const RoleSchema = Type.Union([
  Type.Literal('COMMUTER'),
  Type.Literal('DRIVER'),
  Type.Literal('OPERATOR'),
  Type.Literal('ADMIN'),
]);

export const SelfRegistrationRoleSchema = Type.Union([
  Type.Literal('COMMUTER'),
  Type.Literal('DRIVER'),
  Type.Literal('OPERATOR'),
]);

export const EmailSchema = Type.String({
  minLength: 3,
  maxLength: 254,
  pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
  examples: ['driver@example.com'],
});

export const PasswordSchema = Type.String({ minLength: 12, maxLength: 128 });
export const TokenSchema = Type.String({ minLength: 20, maxLength: 512 });

export const UserSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: EmailSchema,
  displayName: Type.String(),
  status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('DISABLED')]),
  emailVerified: Type.Boolean(),
  roles: Type.Array(RoleSchema),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export const ErrorSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
}, {
  description: 'Machine-readable API error response.',
  examples: [
    {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId: 'req-1',
      },
    },
  ],
});

export const MessageSchema = Type.Object(
  { message: Type.String() },
  { examples: [{ message: 'Operation completed successfully.' }] },
);
