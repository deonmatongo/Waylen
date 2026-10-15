/**
 * Insurance quote → purchase flow (PRD §5.2, §6.1).
 *
 * Needs a real database. Registers a real student through the public auth
 * system (not a direct insert) so the whole path — register, verify, log in,
 * quote, purchase — is exercised exactly as a student would hit it. Creates
 * one run-scoped ACTIVE INSURANCE partner so the purchase always has one to
 * attribute the Referral to, regardless of whatever partners already exist
 * from seeding. Cleans up precisely by run id, never with a broad delete.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';

let app: Express;
let prisma: PrismaClient;

const RUN_ID = `insurance-${Date.now()}`;
const EMAIL = `${RUN_ID}@example.com`;
const PASSWORD = 'Str0ngPassw0rd!';
const PARTNER_SLUG = `test-insurance-partner-${RUN_ID}`;

let authCookies = '';

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

async function primeCsrf(path: string, cookies = ''): Promise<{ cookies: string; csrfToken: string }> {
  const res = await request(app).get(path).set('Cookie', cookies);
  return { cookies: mergeCookies(cookies, res), csrfToken: extractCsrfToken(res.text) };
}

beforeAll(async () => {
  const appModule = await import('../../src/app.js');
  const dbModule = await import('../../src/config/database.js');
  app = appModule.createApp();
  prisma = dbModule.prisma;

  // A guaranteed ACTIVE INSURANCE partner for this run — purchase() picks
  // *an* active INSURANCE partner, not necessarily this one, if seed data
  // already has one; the assertions below only require the partner it does
  // pick to actually be an active INSURANCE partner.
  await prisma.partner.create({
    data: {
      slug: PARTNER_SLUG,
      name: `Test Insurance Partner ${RUN_ID}`,
      category: 'INSURANCE',
      status: 'ACTIVE',
    },
  });

  const { cookies, csrfToken } = await primeCsrf('/register');
  await request(app)
    .post('/register')
    .set('Cookie', cookies)
    .type('form')
    .send({
      fullName: 'Insurance Tester',
      email: EMAIL,
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
      acceptTerms: 'on',
      _csrf: csrfToken,
    });

  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
  });

  const login = await primeCsrf('/login');
  const loginRes = await request(app)
    .post('/login')
    .set('Cookie', login.cookies)
    .type('form')
    .send({ email: EMAIL, password: PASSWORD, _csrf: login.csrfToken });

  authCookies = mergeCookies(login.cookies, loginRes);
});

afterAll(async () => {
  // Cascades the student's referrals and insurance policies.
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.partner.deleteMany({ where: { slug: PARTNER_SLUG } });
  await prisma.$disconnect();
});

describe('insurance quote', () => {
  it('computes a premium for valid cover dates', async () => {
    const res = await request(app)
      .get('/portal/insurance/quote')
      .set('Cookie', authCookies)
      .query({ coverageType: 'TRAVEL', coverageStartsAt: '2026-11-01', coverageEndsAt: '2026-11-11' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Your quote');
    // 10 days at the TRAVEL rate (150/day), plus the 1500 flat admin fee.
    expect(res.text).toContain('€30.00');
    expect(res.text).toContain('name="_csrf"');
  });

  it('shows the request form (no quote) when no dates are given', async () => {
    const res = await request(app).get('/portal/insurance/quote').set('Cookie', authCookies);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Your quote');
  });

  it('rejects an end date before the start date', async () => {
    const res = await request(app)
      .get('/portal/insurance/quote')
      .set('Cookie', authCookies)
      .query({ coverageType: 'TRAVEL', coverageStartsAt: '2026-11-11', coverageEndsAt: '2026-11-01' });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Your quote');
  });
});

describe('insurance purchase (end-to-end)', () => {
  it('creates the policy, logs a Referral, and the student can see their policy', async () => {
    // Several sequential round trips to a real remote database; the default
    // 5s test timeout is too tight for that over a network connection.
    const quoteRes = await request(app)
      .get('/portal/insurance/quote')
      .set('Cookie', authCookies)
      .query({ coverageType: 'COMBINED', coverageStartsAt: '2026-12-01', coverageEndsAt: '2026-12-15' });
    const csrfToken = extractCsrfToken(quoteRes.text);

    const purchaseRes = await request(app)
      .post('/portal/insurance/purchase')
      .set('Cookie', authCookies)
      .type('form')
      .send({
        coverageType: 'COMBINED',
        coverageStartsAt: '2026-12-01',
        coverageEndsAt: '2026-12-15',
        _csrf: csrfToken,
      });

    expect(purchaseRes.status).toBe(303);
    // Payments on: straight to the premium invoice; off: back to the policy list.
    expect(purchaseRes.headers.location).toMatch(/^\/portal\/(insurance|invoices\/[^/]+)$/);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const student = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: user.id } });

    const policy = await prisma.insurancePolicy.findFirstOrThrow({
      where: { studentProfileId: student.id },
    });
    // 14 days at the COMBINED rate (350/day), plus the 1500 flat admin fee.
    expect(policy.premiumMinor).toBe(1500 + 14 * 350);
    expect(policy.currency).toBe('EUR');
    expect(policy.coverageType).toBe('COMBINED');
    expect(policy.policyNumber).toMatch(/^WYL-INS-/);
    expect(policy.partnerId).not.toBeNull();
    // Cover is only active once the premium invoice is paid.
    expect(policy.status).toBe('PENDING');
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { studentProfileId: student.id, lineItems: { some: { category: 'INSURANCE' } } },
    });
    expect(invoice.totalMinor).toBe(policy.premiumMinor);

    const partner = await prisma.partner.findUniqueOrThrow({ where: { id: policy.partnerId! } });
    expect(partner.category).toBe('INSURANCE');
    expect(partner.status).toBe('ACTIVE');

    const referral = await prisma.referral.findFirstOrThrow({
      where: { studentProfileId: student.id },
    });
    expect(referral.partnerId).toBe(policy.partnerId);
    expect(referral.sourceContext).toBe('portal.insurance');
    expect(referral.status).toBe('INITIATED');
    expect(referral.createdById).toBe(user.id);

    const indexRes = await request(app).get('/portal/insurance').set('Cookie', authCookies);
    expect(indexRes.status).toBe(200);
    expect(indexRes.text).toContain(policy.policyNumber!);
  }, 20_000);

  it('rejects a purchase with invalid cover dates', async () => {
    // Prime against a page that actually renders a `_csrf` field — the quote
    // page only renders the purchase form (with its token) once a *valid*
    // quote query is given; the dates sent in the POST body below are the
    // ones under test, independent of these.
    const prime = await primeCsrf(
      '/portal/insurance/quote?coverageType=HEALTH&coverageStartsAt=2026-12-01&coverageEndsAt=2026-12-15',
      authCookies,
    );
    const res = await request(app)
      .post('/portal/insurance/purchase')
      .set('Cookie', prime.cookies)
      .type('form')
      .send({
        coverageType: 'HEALTH',
        coverageStartsAt: '2026-12-15',
        coverageEndsAt: '2026-12-01',
        _csrf: prime.csrfToken,
      });

    expect(res.status).toBe(422);
  });
});
