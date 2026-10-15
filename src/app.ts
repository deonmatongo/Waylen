/**
 * Express application assembly.
 *
 * Exported without listening so integration tests can mount it with supertest.
 * Route mounting order encodes the three PRD layers: public website, portal,
 * back-office.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import expressLayouts from 'express-ejs-layouts';
import { pinoHttp } from 'pino-http';

import { env } from './config/env.js';
import { logger, serializeRequest } from './config/logger.js';
import { prisma } from './config/database.js';
import { sessionMiddleware } from './middleware/session.js';
import { csrfProtection, exposeCsrfToken } from './middleware/csrf.js';
import { attachLocals } from './middleware/locals.js';
import { flashMiddleware } from './middleware/flash.js';
import { safeRedirects } from './middleware/safeRedirect.js';
import { globalRateLimiter } from './middleware/rateLimit.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { registerRoutes } from './routes/index.js';
import { webhookRouter } from './routes/webhooks.js';
import { cronRouter } from './routes/cron.js';
import { apiRouter } from './routes/api/index.js';
import * as viewHelpers from './utils/format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): Express {
  const app = express();

  // Behind a load balancer / reverse proxy in production — needed for secure
  // cookies and accurate client IPs in the audit log.
  if (env.isProduction) app.set('trust proxy', 1);

  // ── Views ────────────────────────────────────────────────────────────────
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.locals.basedir = path.join(__dirname, 'views');

  // Layouts. Controllers override with `layout: 'layouts/portal'` etc; the
  // public site gets the default. `extractScripts` lets a page push a <script>
  // into the layout's footer rather than mid-body.
  app.use(expressLayouts);
  app.set('layout', 'layouts/main');
  app.set('layout extractScripts', true);
  app.set('layout extractStyles', true);

  // View helpers, available in every template without a controller passing them.
  app.locals.format = viewHelpers;

  // ── Security headers ─────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: env.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // Helmet has no Permissions-Policy option, so it is set directly below.
      hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );

  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    );
    next();
  });

  // ── Request pipeline ─────────────────────────────────────────────────────
  // Reset/verify tokens and `_csrf` query values are masked in the logged URL.
  app.use(
    pinoHttp({
      logger,
      serializers: { req: serializeRequest },
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/readyz' },
    }),
  );
  app.use(compression());

  // Provider webhooks need the untouched raw body for signature checks, and
  // cron calls carry a bearer secret — neither uses cookies. Mount both before
  // the body parsers, session and CSRF so none of them can interfere.
  app.use('/webhooks', webhookRouter);
  app.use('/cron', cronRouter);

  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(globalRateLimiter);

  // Static assets. `public/uploads` is explicitly NOT served — student
  // documents are streamed through an authorised controller (PRD §8.1, §8.2),
  // so anything that ends up under that directory must never be reachable by
  // URL. Without this guard `express.static` over `public/` would serve it.
  app.use('/uploads', (_req, res) => {
    res.status(404).end();
  });
  app.use(
    express.static(path.join(process.cwd(), 'public'), {
      maxAge: env.isProduction ? '30d' : 0,
      index: false,
      etag: true,
    }),
  );

  // ── Mobile JSON API — JWT-authenticated, session- and CSRF-free ─────────
  app.use('/api/v1', apiRouter);

  // ── Session, CSRF, view locals ───────────────────────────────────────────
  app.use(sessionMiddleware());
  app.use(flashMiddleware);
  app.use(csrfProtection);
  app.use(exposeCsrfToken);
  app.use(attachLocals);
  app.use(safeRedirects);

  // ── Liveness probe ───────────────────────────────────────────────────────
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ── Readiness probe ──────────────────────────────────────────────────────
  // Unlike /healthz this touches the database, so an orchestrator can hold
  // traffic back while the DB is unreachable. Reports nothing but up/down.
  app.get('/readyz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch (err) {
      logger.error({ err }, 'Readiness check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // ── Routes ───────────────────────────────────────────────────────────────
  registerRoutes(app);

  // ── Terminal handlers ────────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
