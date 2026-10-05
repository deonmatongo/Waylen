/**
 * Insurance and Partner Directory feature gating (PRD §9), once both flags
 * default to `true` (see src/config/env.ts) — mirrors
 * tests/integration/smoke.test.ts's "feature gating" describe block, but
 * needs its own app instance built with both flags forced back off, so it
 * lives in its own file: each vitest test file gets an isolated module
 * registry, so mutating `process.env` here before importing `src/app.js`
 * cannot leak into any other test file.
 *
 * Needs a real database — logs in as real STUDENT and ADMIN_STAFF users so
 * the "not just redirected-because-anonymous" checks are genuine: an
 * authenticated request that still gets a 404 proves `requireFeature` itself
 * is doing the gating, not just `requireAuth`/`requireStaff`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';

process.env.FEATURE_INSURANCE = 'false';
process.env.FEATURE_PARTNER_DIRECTORY = 'false';

let app: Express;
let prisma: PrismaClient;

const RUN_ID = `feature-gating-${Date.now()}`;
const STUDENT_EMAIL = `${RUN_ID}-student@example.com`;
const ADMIN_EMAIL = `${RUN_ID}-admin@example.com`;
const PASSWORD = 'Str0ngPassw0rd!';

let studentCookies = '';
let adminCookies = '';

function toPairs(cookieHeader: string): Map<string, string> {
  if (!cookieHeader) return new Map();
  return new Map(
    cookieHeader
      .split('; ')
      .filter(Boolean)
      .map((pair) => [pair.split('=')[0]!, pair]),
  );
}

function fromPairs(pairs: Map<string, string>): string {
  return [...pairs.values()].join('; ');
}

function mergeCookies(existing: string, res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  if (!setCookie) return existing;
  const pairs = toPairs(existing);
  for (const raw of setCookie) {
    const pair = raw.split(';')[0]!;
    pairs.set(pair.split('=')[0]!, pair);
  }
  return fromPairs(pairs);
}

function extractCsrfToken(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error('No CSRF token found on page');
  return match[1]!;
}

async function loginAs(email: string, password: string): Promise<string> {
  const loginPage = await request(app).get('/login');
  const cookies = mergeCookies('', loginPage);
  const csrfToken = extractCsrfToken(loginPage.text);
  const res = await request(app)
    .post('/login')
    .set('Cookie', cookies)
    .type('form')
    .send({ email, password, _csrf: csrfToken });
  return mergeCookies(cookies, res);
}

beforeAll(async () => {
  const appModule = await import('../../src/app.js');
  const dbModule = await import('../../src/config/database.js');
  const { hashPassword } = await import('../../src/utils/crypto.js');
  const { env, features } = await import('../../src/config/env.js');

  // Sanity-check the env override actually took before trusting the rest of
  // this file's assertions.
  expect(features.insurance).toBe(false);
  expect(features.partnerDirectory).toBe(false);
  expect(env.NODE_ENV).toBe('test');

  app = appModule.createApp();
  prisma = dbModule.prisma;

  const passwordHash = await hashPassword(PASSWORD);

  await prisma.user.create({
    data: {
      email: STUDENT_EMAIL,
      fullName: 'Feature Gating Student',
      passwordHash,
      role: 'STUDENT',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      studentProfile: { create: { reference: `WYL-STU-GATE${Date.now()}` } },
    },
  });

  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      fullName: 'Feature Gating Admin',
      passwordHash,
      role: 'ADMIN_STAFF',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  studentCookies = await loginAs(STUDENT_EMAIL, PASSWORD);
  adminCookies = await loginAs(ADMIN_EMAIL, PASSWORD);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN_ID } } });
  await prisma.$disconnect();
});

describe('feature gating — Insurance off (PRD §9)', () => {
  it('redirects an anonymous request before the flag is even checked', async () => {
    const res = await request(app).get('/portal/insurance');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('404s a logged-in student on every insurance route', async () => {
    const paths = ['/portal/insurance', '/portal/insurance/quote'];
    for (const path of paths) {
      const res = await request(app).get(path).set('Cookie', studentCookies);
      expect(res.status).toBe(404);
    }
  });
});

describe('feature gating — Partner Directory off (PRD §9)', () => {
  it('redirects an anonymous request before the flag is even checked', async () => {
    const res = await request(app).get('/admin/partners');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('404s a logged-in admin on every partner/referral route', async () => {
    const paths = ['/admin/partners', '/admin/partners/new', '/admin/referrals'];
    for (const path of paths) {
      const res = await request(app).get(path).set('Cookie', adminCookies);
      expect(res.status).toBe(404);
    }
  });
});
