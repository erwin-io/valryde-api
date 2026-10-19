import type { ChallengeType } from '../domain/identity.js';
import type { EmailConfig } from '../config.js';
import type { EmailService } from './email-service.js';

export interface AuthNotification {
  type: ChallengeType;
  email: string;
  token: string;
}

export interface NotificationService {
  sendAuthChallenge(notification: AuthNotification): Promise<void>;
}

export class DisabledNotificationService implements NotificationService {
  async sendAuthChallenge(notification: AuthNotification): Promise<void> {
    void notification;
    // Delivery is intentionally disabled until an owner selects and configures a provider.
    // Challenge tokens remain available only in their hashed database representation.
  }
}

export class EmailNotificationService implements NotificationService {
  constructor(
    private readonly email: EmailService,
    private readonly config: Extract<EmailConfig, { deliveryMode: 'smtp' }>,
  ) {}

  async sendAuthChallenge(notification: AuthNotification): Promise<void> {
    const content = challengeContent(notification.type);
    const url = new URL(content.origin(this.config));
    url.searchParams.set('token', notification.token);
    await this.email.send({
      to: notification.email,
      subject: content.subject,
      text: `${content.instruction}\n\n${url.toString()}\n\nThis link expires soon. If you did not request it, you can ignore this email.`,
      html: `<p>${content.instruction}</p><p><a href="${escapeHtml(url.toString())}">Continue in VALRYDE</a></p><p>This link expires soon. If you did not request it, you can ignore this email.</p>`,
    });
  }
}

function challengeContent(type: ChallengeType) {
  if (type === 'VERIFY_EMAIL') {
    return {
      subject: 'Verify your VALRYDE email',
      instruction: 'Verify your email address to finish setting up your VALRYDE account.',
      origin: (config: Extract<EmailConfig, { deliveryMode: 'smtp' }>) => config.verificationOrigin,
    };
  }
  if (type === 'RESET_PASSWORD') {
    return {
      subject: 'Reset your VALRYDE password',
      instruction: 'Use this link to reset your VALRYDE password.',
      origin: (config: Extract<EmailConfig, { deliveryMode: 'smtp' }>) => config.passwordResetOrigin,
    };
  }
  return {
    subject: 'Confirm your new VALRYDE email',
    instruction: 'Use this link to confirm your new email address.',
    origin: (config: Extract<EmailConfig, { deliveryMode: 'smtp' }>) => config.emailChangeOrigin,
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
