/**
 * Transactional email (PRD §8.1 — email automation for notifications,
 * reminders and confirmations).
 *
 * Templates are EJS files under `src/views/emails`, rendered server-side so
 * the same layout system covers both web pages and mail.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAIL_VIEWS = path.join(__dirname, '..', 'views', 'emails');

export interface MailOptions {
  to: string;
  subject: string;
  /** Template filename without extension, e.g. 'verify-email'. */
  template: string;
  data?: Record<string, unknown>;
  replyTo?: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (env.MAIL_DRIVER === 'console') {
    // Development default: nothing leaves the machine, mail is logged instead.
    transporter = nodemailer.createTransport({ jsonTransport: true });
  } else {
    transporter = nodemailer.createTransport({
      host: env.MAIL_HOST,
      port: env.MAIL_PORT,
      secure: env.MAIL_SECURE,
      auth: env.MAIL_USER ? { user: env.MAIL_USER, pass: env.MAIL_PASSWORD } : undefined,
      pool: true,
      maxConnections: 5,
    });
  }

  return transporter;
}

export const mailService = {
  async send(options: MailOptions): Promise<void> {
    // `ejs.renderFile` is typed as returning `any`; with `async: true` it is a
    // string, so narrow it once here rather than at every use below.
    const html: string = await ejs.renderFile(
      path.join(EMAIL_VIEWS, `${options.template}.ejs`),
      {
        appName: env.APP_NAME,
        appUrl: env.APP_URL,
        currentYear: new Date().getFullYear(),
        subject: options.subject,
        ...options.data,
      },
      { async: true },
    );

    const info = await getTransporter().sendMail({
      from: `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM_ADDRESS}>`,
      to: options.to,
      subject: options.subject,
      html,
      // Crude but adequate plain-text fallback for clients that need one.
      text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    });

    if (env.MAIL_DRIVER === 'console') {
      logger.info(
        { to: options.to, subject: options.subject, template: options.template },
        'Email (console driver — not actually sent)',
      );
    } else {
      logger.info({ to: options.to, messageId: info.messageId }, 'Email sent');
    }
  },

  /** Boot-time check so a broken mail relay surfaces before a student hits it. */
  async verifyConnection(): Promise<boolean> {
    try {
      await getTransporter().verify();
      return true;
    } catch (err) {
      logger.error({ err }, 'Mail transport verification failed');
      return false;
    }
  },
};
