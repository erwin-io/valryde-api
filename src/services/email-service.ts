import nodemailer from 'nodemailer';

import type { EmailConfig } from '../config.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}

export class DisabledEmailService implements EmailService {
  async send(message: EmailMessage): Promise<void> {
    void message;
  }
}

export class SmtpEmailService implements EmailService {
  private readonly transport;

  constructor(private readonly config: Extract<EmailConfig, { deliveryMode: 'smtp' }>) {
    this.transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      ...(config.smtp.user === undefined
        ? {}
        : { auth: { user: config.smtp.user, pass: config.smtp.password } }),
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.from, ...message });
  }
}
