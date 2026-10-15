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

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '(c)',
  ndash: '-', mdash: '-', hellip: '...', lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"',
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Plain-text alternative for an HTML email: links become `text (url)`,
 * block elements become line breaks, entities are decoded.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(head|style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, d: string, sq: string, inner: string) => {
      const url = decodeEntities((d ?? sq ?? '').trim());
      const label = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      if (!url || url.startsWith('#') || url.toLowerCase().startsWith('javascript:')) return label;
      if (!label || label === url || label === url.replace(/^mailto:/i, '')) return url;
      return `${label} (${url})`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|tr|ul|ol|table|li|blockquote)>/gi, '\n\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(text)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
    // Fail loudly rather than silently pretending to deliver real mail.
    if (env.NODE_ENV === 'production' && env.MAIL_DRIVER === 'console') {
      logger.error(
        { to: options.to, template: options.template },
        'MAIL_DRIVER=console in production: email NOT sent. Configure MAIL_DRIVER=smtp.',
      );
      throw new Error('Mail is not configured for production (MAIL_DRIVER=console); email was not sent.');
    }

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
      text: htmlToText(html),
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
