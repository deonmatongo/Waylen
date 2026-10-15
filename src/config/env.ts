/**
 * Validated environment configuration.
 *
 * The process fails fast on boot if anything required is missing or malformed,
 * so a misconfigured deploy never reaches the point of serving requests.
 */
import 'dotenv/config';
import { z } from 'zod';

// Fail closed on serverless: Vercel always sets NODE_ENV=production, but if it
// is ever missing there, defaulting to 'development' would silently disable
// secure cookies, HSTS and `trust proxy`. Locally (tsx watch) it stays
// 'development' by default.
if (!process.env.NODE_ENV && (process.env.VERCEL || process.env.VERCEL_ENV)) {
  process.env.NODE_ENV = 'production';
}

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
  // Direct (non-pooled) connection, used by Prisma Migrate. Not read at
  // request time, but required so `prisma migrate deploy` never runs
  // against a missing value in production.
  DIRECT_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_HOURS: z.coerce.number().int().positive().default(720),

  // Mobile refresh-token flow (security audit follow-up — see
  // services/refreshToken.service.ts): a short-lived access JWT paired with a
  // longer-lived, rotatable, revocable refresh token stored hashed server-side.
  // JWT_TTL_HOURS above is superseded for newly issued access tokens by
  // ACCESS_TOKEN_TTL_MINUTES; left in place rather than removed/renamed so an
  // existing .env keeps parsing.
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

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

  // Shared rate-limit store (src/middleware/rateLimit.ts). Optional: when
  // unset, rate limiting falls back to the per-process in-memory store.
  // Upstash's REST client talks plain HTTPS, not a pooled TCP connection, so
  // it's the one that works from Vercel's serverless functions.
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  MS_GRAPH_TENANT_ID: z.string().optional(),
  MS_GRAPH_CLIENT_ID: z.string().optional(),
  MS_GRAPH_CLIENT_SECRET: z.string().optional(),
  MS_GRAPH_ORGANISER_UPN: z.string().optional(),
  /** IANA or Windows time zone name the organiser's working hours are quoted in. */
  MS_GRAPH_TIMEZONE: z.string().default('UTC'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional(),

  // Authenticates Vercel Cron's calls to /cron/*. Vercel injects this as
  // `Authorization: Bearer $CRON_SECRET` automatically once the env var is
  // set on the project — required in production so those routes can't be
  // triggered by anyone who finds the URL.
  CRON_SECRET: z.string().min(32).optional(),

  FEATURE_PAYMENTS: bool.default('false'),
  FEATURE_INSURANCE: bool.default('true'),
  FEATURE_PARTNER_DIRECTORY: bool.default('true'),
  FEATURE_COMMUNITY: bool.default('false'),
  FEATURE_AGENT_PORTAL: bool.default('false'),

  // When true, staff without TOTP enrolled are redirected to /account/security
  // from every /admin route until they enrol.
  MFA_REQUIRED_FOR_STAFF: bool.default('false'),
});

// Case-insensitive substrings that mark a copied-from-.env.example or test value.
const PLACEHOLDER_MARKERS = ['replace-me', 'changeme', 'test-'];

const refined = schema.superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production' && !data.CRON_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CRON_SECRET'],
      message: 'CRON_SECRET is required in production to authenticate /cron/* routes',
    });
  }

  if (data.NODE_ENV === 'production') {
    if (!data.APP_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message: 'APP_URL must be an https:// URL in production',
      });
    }
    if (!data.TRUSTED_ORIGINS.split(',').some((s) => s.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TRUSTED_ORIGINS'],
        message: 'TRUSTED_ORIGINS must be set in production (CSRF/origin allow-list)',
      });
    }

    if (data.MAIL_DRIVER === 'console') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAIL_DRIVER'],
        message: 'MAIL_DRIVER=console only logs emails; set MAIL_DRIVER=smtp in production',
      });
    } else {
      for (const key of ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER'] as const) {
        if (!data[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when MAIL_DRIVER=smtp in production`,
          });
        }
      }
    }

    if (!data.UPSTASH_REDIS_REST_URL || !data.UPSTASH_REDIS_REST_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['UPSTASH_REDIS_REST_URL'],
        message:
          'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production (shared rate-limit store)',
      });
    }

    const secrets = {
      SESSION_SECRET: data.SESSION_SECRET,
      CSRF_SECRET: data.CSRF_SECRET,
      JWT_SECRET: data.JWT_SECRET,
      DOCUMENT_ENCRYPTION_KEY: data.DOCUMENT_ENCRYPTION_KEY,
      CRON_SECRET: data.CRON_SECRET,
    };
    for (const [key, value] of Object.entries(secrets)) {
      const marker = value && PLACEHOLDER_MARKERS.find((m) => value.toLowerCase().includes(m));
      if (marker) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} contains the placeholder marker "${marker}"; generate a real secret`,
        });
      }
    }

    if (
      data.FEATURE_PAYMENTS &&
      !data.STRIPE_SECRET_KEY &&
      !data.PAYSTACK_SECRET_KEY &&
      !data.FLUTTERWAVE_SECRET_KEY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FEATURE_PAYMENTS'],
        message:
          'FEATURE_PAYMENTS=true requires at least one gateway key (STRIPE_SECRET_KEY, PAYSTACK_SECRET_KEY or FLUTTERWAVE_SECRET_KEY) in production',
      });
    }

    if (data.STORAGE_DRIVER === 'local' && process.env.VERCEL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_DRIVER'],
        message:
          'STORAGE_DRIVER=local is not viable on Vercel/serverless (ephemeral filesystem); set STORAGE_DRIVER=s3',
      });
    }
    if (data.STORAGE_DRIVER === 's3') {
      const required = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
      for (const key of required) {
        if (!data[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3 in production`,
          });
        }
      }
    }
  }

  if (Boolean(data.UPSTASH_REDIS_REST_URL) !== Boolean(data.UPSTASH_REDIS_REST_TOKEN)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['UPSTASH_REDIS_REST_TOKEN'],
      message:
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together, or not at all',
    });
  }
});

const parsed = refined.safeParse(process.env);

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
