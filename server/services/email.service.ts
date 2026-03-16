import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { verificationEmail, passwordResetEmail, accountDeletionEmail } from '../../email-templates.js';

export class EmailService {
  private transporter!: nodemailer.Transporter;
  private from: string;

  constructor() {
    this.from = config.SMTP_FROM;
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });
  }

  async sendVerificationEmail(to: string, token: string, username: string): Promise<void> {
    const verifyUrl = `${config.APP_URL}/verify-email?token=${token}`;
    const { subject, html, text } = verificationEmail(username, verifyUrl);
    await this._send(to, subject, html, text);
  }

  async sendPasswordResetEmail(to: string, token: string, username: string): Promise<void> {
    const resetUrl = `${config.APP_URL}/reset-password?token=${token}`;
    const { subject, html, text } = passwordResetEmail(username, resetUrl);
    await this._send(to, subject, html, text);
  }

  async sendAccountDeletionConfirmEmail(to: string, username: string, scheduledAt: string): Promise<void> {
    const cancelUrl = `${config.APP_URL}/account/cancel-deletion`;
    const { subject, html, text } = accountDeletionEmail(username, cancelUrl, scheduledAt);
    await this._send(to, subject, html, text);
  }

  private async _send(to: string, subject: string, html: string, text: string): Promise<void> {
    console.log(`[EmailService] ── 发送邮件 ──`);
    console.log(`  To:      ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body:    ${text}\n`);
    await this.transporter.sendMail({ from: this.from, to, subject, html, text });
  }
}

export const emailService = new EmailService();
