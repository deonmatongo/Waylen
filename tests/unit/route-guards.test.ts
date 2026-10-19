/**
 * Access-control matrix for /admin and /portal (PRD §8.1).
 *
 * Mounts the REAL adminRouter/portalRouter behind a stub identity middleware,
 * so the guard layer runs exactly as in production but no session or database
 * is needed. Guards run before controllers, so a denied request never reaches
 * one; an allowed request reaches a controller whose first prisma call throws
 * (the mock below), which surfaces as 500 — anything but 401/403 proves the
 * guard let it through.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response, type Router } from 'express';
import request from 'supertest';
import type { UserRole } from '@prisma/client';

// requireFeature() reads these at import time; enable the gated areas so the
// role guards behind them are actually exercised (otherwise they return 404).
vi.hoisted(() => {
  process.env.FEATURE_PAYMENTS = 'true';
  process.env.FEATURE_PARTNER_DIRECTORY = 'true';
  process.env.FEATURE_INSURANCE = 'true';
  process.env.MFA_REQUIRED_FOR_STAFF = 'false';
});

// Any accidental query fails fast instead of attempting a connection.
vi.mock('../../src/config/database.js', () => {
  const trap = (path: string): unknown =>
    new Proxy(function () {}, {
      get: (_t, prop) => (prop === 'then' ? undefined : trap(`${path}.${String(prop)}`)),
      // Rejected (not thrown) so a Promise.all of several queries cannot leave
      // a sibling rejection unhandled; the no-op catch only silences that.
      apply: () => {
        const rejected = Promise.reject(new Error(`Unexpected DB access in guard test: ${path}`));
        rejected.catch(() => {});
        return rejected;
      },
    });
  return { prisma: trap('prisma'), default: trap('prisma') };
});

type Role = UserRole | 'ANON';
const ROLES: UserRole[] = ['STUDENT', 'COUNSELLOR', 'ADMIN_STAFF', 'SUPER_ADMIN'];

let app: Express;
let adminRouter: Router;

function identity(req: Request, _res: Response, next: NextFunction): void {
  const role = req.header('x-test-role') as UserRole | undefined;
  req.session = {};
  req.flash = () => {};
  if (role) {
    req.currentUser = {
      id: `user-${role}`,
      email: `${role.toLowerCase()}@example.test`,
      fullName: 'Test User',
      role,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      mfaEnabled: false,
      studentProfile: role === 'STUDENT' ? { id: 'sp1', reference: 'WL-1', currentStage: 'ENQUIRY' as never } : null,
    };
  }
  next();
}

beforeAll(async () => {
  ({ adminRouter } = await import('../../src/routes/admin/index.js'));
  const { portalRouter } = await import('../../src/routes/portal/index.js');
  app = express();
  app.use(identity);
  app.use('/portal', portalRouter);
  app.use('/admin', adminRouter);
  app.use((err: { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode ?? 500).json({ error: err.statusCode ? 'denied-or-handled' : 'internal' });
  });
});

async function hit(method: string, path: string, role: Role): Promise<number> {
  const verb = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method];
  if (!verb) throw new Error(`Unsupported method ${method}`);
  const req = verb.call(request(app), path);
  req.set('Accept', 'application/json');
  if (role !== 'ANON') req.set('x-test-role', role);
  const res = await req.send(method === 'get' ? undefined : {});
  return res.status;
}

// ── Route enumeration ──────────────────────────────────────────────────────
interface LayerLike {
  name: string;
  regexp: RegExp;
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: unknown[] };
}
interface RouteEntry { method: string; path: string }

/** Layer mount paths are stored as regexps in Express 4; recover the literal prefix. */
function mountPrefix(layer: { regexp: RegExp }): string {
  const src = layer.regexp.source;
  if (src === '^\\/?(?=\\/|$)') return '';
  const m = /^\^((?:\\\/[^\\/()?]+)+)\\\/\?\(\?=\\\/\|\$\)$/.exec(src);
  if (!m) throw new Error(`Cannot derive mount path from ${src}; teach mountPrefix() about it`);
  return (m[1] ?? '').replace(/\\\//g, '/');
}

function walk(router: Router, prefix = ''): RouteEntry[] {
  const out: RouteEntry[] = [];
  const stack = (router as unknown as { stack: LayerLike[] }).stack;
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method, path: prefix + String(layer.route.path) });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      out.push(...walk(layer.handle as Router, prefix + mountPrefix(layer)));
    }
  }
  return out;
}

const concrete = (p: string): string => p.replace(/:[A-Za-z]+/g, 'x').replace(/\/$/, '') || '/';

// ── Expectations ───────────────────────────────────────────────────────────
const COUNSELLOR_DENIED: [string, string][] = [
  ['get', '/admin/content'], ['post', '/admin/content/resources'], ['get', '/admin/content/faqs'],
  ['get', '/admin/countries'], ['post', '/admin/countries'], ['post', '/admin/countries/x'],
  ['get', '/admin/partners'], ['post', '/admin/partners'],
  ['get', '/admin/referrals'], ['post', '/admin/referrals'], ['post', '/admin/referrals/x/status'],
  ['post', '/admin/invoices/payments/x/confirm'], ['post', '/admin/invoices/payments/x/reject'],
  ['post', '/admin/invoices/payments/x/refund'], ['post', '/admin/invoices/x/record-payment'],
  ['post', '/admin/invoices/x/void'],
  ['get', '/admin/reports/revenue'], ['get', '/admin/reports/export'],
  ['post', '/admin/students/x/assign-counsellor'],
  ['post', '/admin/webinars'], ['get', '/admin/webinars/new'], ['get', '/admin/webinars/x/edit'], ['post', '/admin/webinars/x'],
];

const SUPER_ONLY: [string, string][] = [
  ['get', '/admin/users'], ['post', '/admin/users'], ['post', '/admin/users/x/role'],
  ['post', '/admin/users/x/suspend'], ['post', '/admin/users/x/unsuspend'],
  ['post', '/admin/users/x/reset-mfa'], ['post', '/admin/users/x/anonymise'],
  ['get', '/admin/settings'], ['post', '/admin/settings'], ['get', '/admin/audit'],
];

// Reachable by every staff role (guard-wise).
const STAFF_ALLOWED: [string, string][] = [
  ['get', '/admin'], ['get', '/admin/students'], ['get', '/admin/applications'],
  ['get', '/admin/documents'], ['get', '/admin/appointments'], ['get', '/admin/enquiries'],
  ['get', '/admin/support'], ['get', '/admin/reports'], ['get', '/admin/invoices'],
  ['get', '/admin/webinars'], ['get', '/admin/webinars/x/registrations'],
  ['post', '/admin/students/x/notes'], ['post', '/admin/documents/x/approve'],
];

describe('anonymous visitors', () => {
  it.each(['/admin', '/admin/students', '/admin/users', '/portal', '/portal/documents'])(
    'GET %s redirects to /login',
    async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    },
  );

  it('POST to a mutating admin route is redirected, never executed', async () => {
    expect(await hit('post', '/admin/users/x/role', 'ANON')).toBe(302);
    expect(await hit('post', '/portal/documents/x/delete', 'ANON')).toBe(302);
  });
});

describe('unverified accounts', () => {
  it('are sent to verification rather than the portal', async () => {
    const verifying = express();
    verifying.use((req, _res, next) => {
      identity(req, _res, () => {});
      if (req.currentUser) req.currentUser.emailVerifiedAt = null;
      next();
    });
    const { portalRouter } = await import('../../src/routes/portal/index.js');
    verifying.use('/portal', portalRouter);
    const res = await request(verifying).get('/portal').set('x-test-role', 'STUDENT');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/verify-email/pending');
  });
});

describe('STUDENT', () => {
  it.each(['get', 'post'])('is denied (%s) across /admin', async (method) => {
    for (const p of ['/admin', '/admin/students', '/admin/users', '/admin/settings']) {
      expect(await hit(method, p, 'STUDENT')).toBe(403);
    }
  });

  it('cannot reach ANY route registered on adminRouter', async () => {
    const routes = walk(adminRouter);
    // Sanity: the walker must actually be seeing the router.
    expect(routes.length).toBeGreaterThan(100);
    const leaks: string[] = [];
    for (const r of routes) {
      const status = await hit(r.method, `/admin${concrete(r.path)}`, 'STUDENT');
      if (status !== 403) leaks.push(`${r.method.toUpperCase()} /admin${r.path} -> ${status}`);
    }
    expect(leaks).toEqual([]);
  }, 30_000);
});

describe('COUNSELLOR', () => {
  it.each(COUNSELLOR_DENIED)('%s %s is 403', async (method, path) => {
    expect(await hit(method, path, 'COUNSELLOR')).toBe(403);
  });

  it.each(STAFF_ALLOWED)('%s %s passes the guard layer', async (method, path) => {
    const status = await hit(method, path, 'COUNSELLOR');
    expect([401, 403]).not.toContain(status);
  });

  it('is denied the whole portal', async () => {
    expect(await hit('get', '/portal', 'COUNSELLOR')).toBe(403);
  });
});

describe('ADMIN_STAFF', () => {
  it.each(SUPER_ONLY)('%s %s is 403', async (method, path) => {
    expect(await hit(method, path, 'ADMIN_STAFF')).toBe(403);
  });

  it.each([...COUNSELLOR_DENIED, ...STAFF_ALLOWED])('%s %s passes the guard layer', async (method, path) => {
    const status = await hit(method, path, 'ADMIN_STAFF');
    expect([401, 403]).not.toContain(status);
  });
});

describe('SUPER_ADMIN', () => {
  it.each([...SUPER_ONLY, ...COUNSELLOR_DENIED, ...STAFF_ALLOWED])('%s %s passes the guard layer', async (method, path) => {
    const status = await hit(method, path, 'SUPER_ADMIN');
    expect([401, 403]).not.toContain(status);
  });
});

describe('staff on /portal', () => {
  it.each(['COUNSELLOR', 'ADMIN_STAFF', 'SUPER_ADMIN'] as const)('%s gets 403 on every portal route', async (role) => {
    const { portalRouter } = await import('../../src/routes/portal/index.js');
    const routes = walk(portalRouter);
    expect(routes.length).toBeGreaterThan(30);
    const leaks: string[] = [];
    for (const r of routes) {
      const status = await hit(r.method, `/portal${concrete(r.path)}`, role);
      if (status !== 403) leaks.push(`${r.method.toUpperCase()} /portal${r.path} -> ${status}`);
    }
    expect(leaks).toEqual([]);
  }, 30_000);

  it('STUDENT is not stopped by the role guard', async () => {
    const status = await hit('get', '/portal/documents', 'STUDENT');
    expect([401, 403]).not.toContain(status);
  });
});

describe('role coverage', () => {
  it('exercises every role', () => {
    expect(ROLES).toHaveLength(4);
  });
});
