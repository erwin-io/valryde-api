import { describe, expect, it } from 'vitest';

import type { EmailConfig } from '../src/config.js';
import type { EmailMessage, EmailService } from '../src/services/email-service.js';
import { EmailNotificationService } from '../src/services/notification-service.js';

const config: Extract<EmailConfig, { deliveryMode: 'smtp' }> = {
  deliveryMode: 'smtp',
  from: 'VALRYDE <no-reply@valryde.local>',
  verificationOrigin: 'http://localhost:4200/auth/verify-email',
  passwordResetOrigin: 'http://localhost:4200/auth/reset-password',
  emailChangeOrigin: 'http://localhost:4200/account/confirm-email-change',
  smtp: { host: '127.0.0.1', port: 1025, secure: false },
};

class CaptureEmail implements EmailService {
  readonly messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

describe('email authentication notifications', () => {
  it.each([
    ['VERIFY_EMAIL', config.verificationOrigin],
    ['RESET_PASSWORD', config.passwordResetOrigin],
    ['VERIFY_EMAIL_CHANGE', config.emailChangeOrigin],
  ] as const)('uses the configured application origin for %s', async (type, origin) => {
    const email = new CaptureEmail();
    const notifications = new EmailNotificationService(email, config);
    await notifications.sendAuthChallenge({
      type,
      email: 'recipient@example.com',
      token: 'opaque-runtime-token',
    });
    expect(email.messages).toHaveLength(1);
    expect(email.messages[0]).toMatchObject({ to: 'recipient@example.com' });
    const url = new URL(origin);
    url.searchParams.set('token', 'opaque-runtime-token');
    expect(email.messages[0]!.text).toContain(url.toString());
    expect(email.messages[0]!.html).toContain('Continue in VALRYDE');
  });
});
