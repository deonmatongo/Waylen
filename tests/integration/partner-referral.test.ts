/**
 * Partner Directory & referral tracking (PRD §6.2, §6.3).
 *
 * Needs a real database. Logs in as a real ADMIN_STAFF user (created
 * directly — registration always creates a STUDENT) to exercise the actual
 * admin HTTP routes: partner CRUD, referral creation, and status transitions
 * through to commission settlement. Every record uses the
 * `partner-referral-<run>` convention below so afterAll can clean up
 * precisely, never with a broad delete.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';

let app: Express;
let prisma: PrismaClient;

const RUN_ID = `partner-referral-${Date.now()}`;
const ADMIN_EMAIL = `${RUN_ID}-admin@example.com`;
const STUDENT_EMAIL = `${RUN_ID}-student@example.com`;
const ADMIN_PASSWORD = 'Str0ngPassw0rd!';

let authCookies = '';
let studentProfileId = '';
let partnerId = '';
let partnerSlug = '';

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

/** Any authenticated admin page with a form carries a fresh `_csrf` field. */
async function freshCsrf(): Promise<{ cookies: string; csrfToken: string }> {
  const res = await request(app).get('/admin/partners/new').set('Cookie', authCookies);
  const cookies = mergeCookies(authCookies, res);
  authCookies = cookies;
  return { cookies, csrfToken: extractCsrfToken(res.text) };
}

beforeAll(async () => {
  const appModule = await import('../../src/app.js');
  const dbModule = await import('../../src/config/database.js');
  const { hashPassword } = await import('../../src/utils/crypto.js');
  const { studentReference } = await import('../../src/utils/reference.js');

  app = appModule.createApp();
  prisma = dbModule.prisma;

  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      fullName: 'Partner Referral Test Admin',
      passwordHash,
      role: 'ADMIN_STAFF',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const studentUser = await prisma.user.create({
    data: {
      email: STUDENT_EMAIL,
      fullName: 'Referral Fixture Student',
      passwordHash,
      role: 'STUDENT',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      studentProfile: { create: { reference: studentReference() } },
    },
    include: { studentProfile: true },
  });
  studentProfileId = studentUser.studentProfile!.id;

  const loginPage = await request(app).get('/login');
  const primeCookies = mergeCookies('', loginPage);
  const primeToken = extractCsrfToken(loginPage.text);

  const loginRes = await request(app)
    .post('/login')
    .set('Cookie', primeCookies)
    .type('form')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, _csrf: primeToken });

  expect(loginRes.status).toBe(303);
  expect(loginRes.headers.location).toBe('/admin');
  authCookies = mergeCookies(primeCookies, loginRes);
});

afterAll(async () => {
  // Referrals and insurance policies cascade from the student; the partner
  // (referenced with onDelete: Restrict) must be freed of referrals first,
  // which deleting the student above already does.
  await prisma.user.deleteMany({ where: { email: { contains: RUN_ID } } });
  if (partnerSlug) await prisma.partner.deleteMany({ where: { slug: partnerSlug } });
  await prisma.$disconnect();
});

describe('partner CRUD (PRD §6.2)', () => {
  it('creates a partner with contract and commission terms', async () => {
    const { cookies, csrfToken } = await freshCsrf();
    const name = `Test Legal Partner ${RUN_ID}`;

    const res = await request(app)
      .post('/admin/partners')
      .set('Cookie', cookies)
      .type('form')
      .send({
        name,
        category: 'LEGAL',
        status: 'ACTIVE',
        countryIds: [],
        contractReference: `REF-${RUN_ID}`,
        contractStartsAt: '2026-01-01',
        contractEndsAt: '2027-01-01',
        commissionTerms: '10% of first-year fees',
        commissionRateBps: '1000',
        markVetted: 'on',
        isPubliclyListed: 'on',
        _csrf: csrfToken,
      });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/partners');

    partnerSlug = `test-legal-partner-${RUN_ID}`.toLowerCase();
    const partner = await prisma.partner.findUniqueOrThrow({ where: { slug: partnerSlug } });
    partnerId = partner.id;

    expect(partner.category).toBe('LEGAL');
    expect(partner.status).toBe('ACTIVE');
    expect(partner.commissionRateBps).toBe(1000);
    expect(partner.contractReference).toBe(`REF-${RUN_ID}`);
    expect(partner.isPubliclyListed).toBe(true);
    expect(partner.vettedAt).not.toBeNull();
  });

  it('shows the partner directory and the new partner', async () => {
    const res = await request(app).get('/admin/partners').set('Cookie', authCookies);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`Test Legal Partner ${RUN_ID}`);
  });

  it('un-vets a partner on update when markVetted is unchecked', async () => {
    const { cookies, csrfToken } = await freshCsrf();

    const res = await request(app)
      .post(`/admin/partners/${partnerId}`)
      .set('Cookie', cookies)
      .type('form')
      .send({
        name: `Test Legal Partner ${RUN_ID}`,
        category: 'LEGAL',
        status: 'ACTIVE',
        countryIds: [],
        commissionRateBps: '1000',
        // markVetted omitted — unchecked checkbox.
        _csrf: csrfToken,
      });

    expect(res.status).toBe(303);
    const partner = await prisma.partner.findUniqueOrThrow({ where: { id: partnerId } });
    expect(partner.vettedAt).toBeNull();
  });
});

describe('referral creation and status transitions (PRD §6.2, §6.3)', () => {
  it('logs a referral against the partner', async () => {
    const { cookies, csrfToken } = await freshCsrf();

    const res = await request(app)
      .post('/admin/referrals')
      .set('Cookie', cookies)
      .type('form')
      .send({
        studentProfileId,
        partnerId,
        sourceContext: 'admin.manual',
        notes: 'Logged by integration test',
        _csrf: csrfToken,
      });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/referrals');

    const referral = await prisma.referral.findFirstOrThrow({
      where: { studentProfileId, partnerId },
    });
    expect(referral.status).toBe('INITIATED');
    expect(referral.sourceContext).toBe('admin.manual');
    expect(referral.notes).toBe('Logged by integration test');
    expect(referral.commissionAmountMinor).toBeNull();
    expect(referral.convertedAt).toBeNull();
  });

  it('transitions INITIATED → CONTACTED without touching commission fields', async () => {
    const referral = await prisma.referral.findFirstOrThrow({ where: { studentProfileId, partnerId } });
    const { cookies, csrfToken } = await freshCsrf();

    const res = await request(app)
      .post(`/admin/referrals/${referral.id}/status`)
      .set('Cookie', cookies)
      .type('form')
      .send({ status: 'CONTACTED', _csrf: csrfToken });

    expect(res.status).toBe(303);

    const updated = await prisma.referral.findUniqueOrThrow({ where: { id: referral.id } });
    expect(updated.status).toBe('CONTACTED');
    expect(updated.convertedAt).toBeNull();
    expect(updated.commissionAmountMinor).toBeNull();
  });

  it('populates commission fields and convertedAt on transition to CONVERTED', async () => {
    const referral = await prisma.referral.findFirstOrThrow({ where: { studentProfileId, partnerId } });
    const { cookies, csrfToken } = await freshCsrf();

    const res = await request(app)
      .post(`/admin/referrals/${referral.id}/status`)
      .set('Cookie', cookies)
      .type('form')
      .send({
        status: 'CONVERTED',
        commissionAmountMinor: '5000',
        commissionCurrency: 'USD',
        _csrf: csrfToken,
      });

    expect(res.status).toBe(303);

    const updated = await prisma.referral.findUniqueOrThrow({ where: { id: referral.id } });
    expect(updated.status).toBe('CONVERTED');
    expect(updated.convertedAt).not.toBeNull();
    expect(updated.commissionAmountMinor).toBe(5000);
    expect(updated.commissionCurrency).toBe('USD');
  });

  it('shows the converted referral, with commission, on the partner page and the referrals list', async () => {
    const [showRes, listRes] = await Promise.all([
      request(app).get(`/admin/partners/${partnerId}`).set('Cookie', authCookies),
      request(app).get('/admin/referrals').set('Cookie', authCookies),
    ]);

    expect(showRes.status).toBe(200);
    expect(showRes.text).toContain('Referral Fixture Student');
    expect(showRes.text).toContain('US$50.00');

    expect(listRes.status).toBe(200);
    expect(listRes.text).toContain('Referral Fixture Student');
  });
});
