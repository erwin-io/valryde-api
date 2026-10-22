import 'dotenv/config';

export type Environment = 'development' | 'test' | 'production';

export interface AppConfig {
  environment: Environment;
  host: string;
  port: number;
  logLevel: string;
  corsOrigins: string[];
  databaseUrl: string;
  databaseSsl: boolean;
  databaseSchema: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  authChallengeTtlMinutes: number;
  authResendCooldownSeconds: number;
  googleClientIds: string[];
  email: EmailConfig;
}

export type EmailConfig =
  | { deliveryMode: 'disabled' }
  | {
      deliveryMode: 'smtp';
      from: string;
      verificationOrigin: string;
      passwordResetOrigin: string;
      emailChangeOrigin: string;
      smtp: {
        host: string;
        port: number;
        secure: boolean;
        user?: string;
        password?: string;
      };
    };

function integer(name: string, value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

// Exact origins only: wildcards, paths and trailing slashes are rejected.
function corsOrigins(value: string | undefined): string[] {
  const origins = (value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(origin);
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || parsed.origin !== origin) {
      throw new Error(`CORS_ORIGINS entry is not an exact origin: ${origin}`);
    }
  }
  return origins;
}

function environment(value: string | undefined): Environment {
  if (value === undefined) return 'development';
  if (value === 'development' || value === 'test' || value === 'production') return value;
  throw new Error('NODE_ENV must be development, test, or production');
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const jwtSecret = source.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters');
  }

  const databaseUrl = source.DATABASE_URL ?? '';
  if (databaseUrl.length === 0) throw new Error('DATABASE_URL is required');

  const databaseSchema = source.DATABASE_SCHEMA ?? 'dbo';
  if (!/^[a-z_][a-z0-9_]*$/.test(databaseSchema)) {
    throw new Error('DATABASE_SCHEMA must be a lowercase PostgreSQL identifier');
  }

  return {
    environment: environment(source.NODE_ENV),
    host: source.HOST ?? '127.0.0.1',
    port: integer('PORT', source.PORT, 3000),
    logLevel: source.LOG_LEVEL ?? 'info',
    corsOrigins: corsOrigins(source.CORS_ORIGINS),
    databaseUrl,
    databaseSsl: source.DATABASE_SSL === 'true',
    databaseSchema,
    jwtSecret,
    jwtIssuer: source.JWT_ISSUER ?? 'valryde-api',
    jwtAudience: source.JWT_AUDIENCE ?? 'valryde-clients',
    accessTokenTtlSeconds: integer(
      'ACCESS_TOKEN_TTL_SECONDS',
      source.ACCESS_TOKEN_TTL_SECONDS,
      900,
    ),
    refreshTokenTtlDays: integer('REFRESH_TOKEN_TTL_DAYS', source.REFRESH_TOKEN_TTL_DAYS, 30),
    authChallengeTtlMinutes: integer(
      'AUTH_CHALLENGE_TTL_MINUTES',
      source.AUTH_CHALLENGE_TTL_MINUTES,
      30,
    ),
    authResendCooldownSeconds: integer(
      'AUTH_RESEND_COOLDOWN_SECONDS',
      source.AUTH_RESEND_COOLDOWN_SECONDS,
      60,
    ),
    googleClientIds: (source.GOOGLE_CLIENT_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    email: emailConfig(source, environment(source.NODE_ENV)),
  };
}

function emailConfig(source: NodeJS.ProcessEnv, env: Environment): EmailConfig {
  const mode = source.EMAIL_DELIVERY_MODE ?? 'disabled';
  if (mode === 'disabled') return { deliveryMode: 'disabled' };
  if (mode !== 'smtp') throw new Error('EMAIL_DELIVERY_MODE must be disabled or smtp');

  const from = required(source, 'EMAIL_FROM');
  const verificationOrigin = webUrl(required(source, 'APP_VERIFICATION_URL'), 'APP_VERIFICATION_URL', env);
  const passwordResetOrigin = webUrl(required(source, 'APP_PASSWORD_RESET_URL'), 'APP_PASSWORD_RESET_URL', env);
  const emailChangeOrigin = webUrl(required(source, 'APP_EMAIL_CHANGE_URL'), 'APP_EMAIL_CHANGE_URL', env);
  const host = required(source, 'SMTP_HOST');
  const user = source.SMTP_USER?.trim() || undefined;
  const password = source.SMTP_PASSWORD || undefined;
  if ((user === undefined) !== (password === undefined)) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must either both be set or both be omitted');
  }

  return {
    deliveryMode: 'smtp',
    from,
    verificationOrigin,
    passwordResetOrigin,
    emailChangeOrigin,
    smtp: {
      host,
      port: integer('SMTP_PORT', source.SMTP_PORT, 1025),
      secure: source.SMTP_SECURE === 'true',
      ...(user === undefined ? {} : { user, password: password as string }),
    },
  };
}

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required when EMAIL_DELIVERY_MODE=smtp`);
  return value;
}

// Emailed links carry a one-time token, so production callbacks must be HTTPS and never embed credentials.
function webUrl(value: string, name: string, env: Environment): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`);
  }
  if (env === 'production' && url.protocol !== 'https:') {
    throw new Error(`${name} must use https in production`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials`);
  }
  return url.toString();
}
