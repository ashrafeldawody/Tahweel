import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';
import { logger } from '../config/log.js';

const log = logger('mail');

export interface Mailer {
  readonly configured: boolean;
  send(subject: string, text: string): Promise<boolean>;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter | null;
  private readonly to: string | undefined;
  private readonly from: string | undefined;

  constructor(env: Pick<Env, 'SMTP_URL' | 'ALERT_EMAIL_TO' | 'ALERT_EMAIL_FROM'>) {
    this.to = env.ALERT_EMAIL_TO;
    this.from = env.ALERT_EMAIL_FROM ?? env.ALERT_EMAIL_TO;
    this.transport = env.SMTP_URL && this.to ? nodemailer.createTransport(env.SMTP_URL) : null;
  }

  get configured(): boolean {
    return this.transport !== null;
  }

  async send(subject: string, text: string): Promise<boolean> {
    if (!this.transport || !this.to) return false;
    try {
      await this.transport.sendMail({ from: this.from, to: this.to, subject: `[Tahweel] ${subject}`, text });
      return true;
    } catch (error) {
      log.warn(`send failed: ${(error as Error).message}`);
      return false;
    }
  }
}

export class RecordingMailer implements Mailer {
  readonly sent: Array<{ subject: string; text: string }> = [];
  readonly configured = true;

  async send(subject: string, text: string): Promise<boolean> {
    this.sent.push({ subject, text });
    return true;
  }
}
