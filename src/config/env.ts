/**
 * Validated environment configuration.
 *
 * The process fails fast on boot if anything required is missing or malformed,
 * so a misconfigured deploy never reaches the point of serving requests.
 */
import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_NAME: z.string().default('Waylen'),
  APP_URL: z.string().url(),
  TRUSTED_ORIGINS: z.string().default(''),

  DATABASE_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_HOURS: z.coerce.number().int().positive().default(720),

  DOCUMENT_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'DOCUMENT_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    }),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage/documents'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(15),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  MAIL_DRIVER: z.enum(['smtp', 'console']).default('console'),
  MAIL_HOST: z.string().optional(),
  MAIL_PORT: z.coerce.number().int().positive().optional(),
  MAIL_SECURE: bool.default('false'),
  MAIL_USER: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  MAIL_FROM_NAME: z.string().default('Waylen'),
  MAIL_FROM_ADDRESS: z.string().email(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),

  MS_GRAPH_TENANT_ID: z.string().optional(),
  MS_GRAPH_CLIENT_ID: z.string().optional(),
  MS_GRAPH_CLIENT_SECRET: z.string().optional(),
  MS_GRAPH_ORGANISER_UPN: z.string().optional(),
  /** IANA or Windows time zone name the organiser's working hours are quoted in. */
  MS_GRAPH_TIMEZONE: z.string().default('UTC'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional(),

  FEATURE_PAYMENTS: bool.default('false'),
  FEATURE_INSURANCE: bool.default('false'),
  FEATURE_PARTNER_DIRECTORY: bool.default('false'),
  FEATURE_COMMUNITY: bool.default('false'),
  FEATURE_AGENT_PORTAL: bool.default('false'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  trustedOrigins: raw.TRUSTED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxUploadBytes: raw.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  documentEncryptionKey: Buffer.from(raw.DOCUMENT_ENCRYPTION_KEY, 'base64'),
} as const;

export const features = {
  payments: raw.FEATURE_PAYMENTS,
  insurance: raw.FEATURE_INSURANCE,
  partnerDirectory: raw.FEATURE_PARTNER_DIRECTORY,
  community: raw.FEATURE_COMMUNITY,
  agentPortal: raw.FEATURE_AGENT_PORTAL,
} as const;

export type Env = typeof env;
export type Features = typeof features;
