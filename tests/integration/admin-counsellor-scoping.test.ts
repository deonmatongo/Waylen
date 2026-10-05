/**
 * Regression coverage for a counsellor-scoping IDOR found in the security
 * review: `admin/invoice.controller.ts` (show/send/recordPayment/
 * sendReminder) and `admin/appointment.controller.ts`
 * (confirm/reschedule/cancel/complete) performed no ownership check at all,
 * unlike their sibling endpoints on the same resources
 * (viewProofOfPayment/confirmPayment/rejectPayment already called
 * `assertCanAccessStudent`) — so any COUNSELLOR could act on any other
 * counsellor's invoices or appointments.
 *
 * Invoices are scoped via the student's `assignedCounsellorId`
 * (`assertCanAccessStudent`). Appointments are scoped via the appointment's
 * own `counsellorId` — the counsellor hosting a session is not necessarily
 * the student's general assigned counsellor, and `index()` already filtered
 * the listing that way, so the fix matches that existing dimension rather
 * than introducing a new one.
 *
 * Needs a real database. Every record uses the `counsellor-scope-<run>`
 * convention below so afterAll can clean up precisely, never with a broad
 * delete.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';

process.env.FEATURE_PAYMENTS = 'true';

let app: Express;
let prisma: PrismaClient;

const RUN_ID = `counsellor-scope-${Date.now()}`;
const COUNSELLOR_A_EMAIL = `${RUN_ID}-counsellor-a@example.com`;
const COUNSELLOR_B_EMAIL = `${RUN_ID}-counsellor-b@example.com`;
const STUDENT_EMAIL = `${RUN_ID}-student@example.com`;
const PASSWORD = 'Str0ngPassw0rd!';

let counsellorAId = '';
let counsellorBId = '';
let studentProfileId = '';
let invoiceId = '';
let assignedAppointmentId = '';
let unassignedAppointmentId = '';

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

async function loginAs(email: string): Promise<string> {
  const form = await request(app).get('/login');
  let cookies = mergeCookies('', form);
  const token = extractCsrfToken(form.text);

  const res = await request(app)
    .post('/login')
    .set('Cookie', cookies)
    .type('form')
    .send({ email, password: PASSWORD, _csrf: token });
  cookies = mergeCookies(cookies, res);
  return cookies;
}

async function freshCsrf(cookies: string, path: string): Promise<{ cookies: string; csrfToken: string }> {
  const res = await request(app).get(path).set('Cookie', cookies);
  const merged = mergeCookies(cookies, res);
  return { cookies: merged, csrfToken: extractCsrfToken(res.text) };
}

beforeAll(async () => {
  const appModule = await import('../../src/app.js');
  const dbModule = await import('../../src/config/database.js');
  const { hashPassword } = await import('../../src/utils/crypto.js');
  const { studentReference } = await import('../../src/utils/reference.js');

  app = appModule.createApp();
  prisma = dbModule.prisma;

  const passwordHash = await hashPassword(PASSWORD);

  const counsellorA = await prisma.user.create({
    data: {
      email: COUNSELLOR_A_EMAIL,
      fullName: 'Counsellor A',
      passwordHash,
      role: 'COUNSELLOR',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  counsellorAId = counsellorA.id;

  const counsellorB = await prisma.user.create({
    data: {
      email: COUNSELLOR_B_EMAIL,
      fullName: 'Counsellor B',
      passwordHash,
      role: 'COUNSELLOR',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  counsellorBId = counsellorB.id;

  const studentUser = await prisma.user.create({
    data: {
      email: STUDENT_EMAIL,
      fullName: 'Scoping Test Student',
      passwordHash,
      role: 'STUDENT',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      studentProfile: {
        create: {
          reference: studentReference(),
          assignedCounsellorId: counsellorAId,
        },
      },
    },
    include: { studentProfile: true },
  });
  studentProfileId = studentUser.studentProfile!.id;

  const invoice = await prisma.invoice.create({
    data: {
      number: `INV-${RUN_ID}`,
      studentProfileId,
      status: 'SENT',
      subtotalMinor: 10_000,
      totalMinor: 10_000,
    },
  });
  invoiceId = invoice.id;

  const assigned = await prisma.appointment.create({
    data: {
      reference: `APT-${RUN_ID}-A`,
      studentProfileId,
      counsellorId: counsellorAId,
      type: 'INITIAL_CONSULTATION',
      status: 'REQUESTED',
      startsAt: new Date(Date.now() + 86_400_000),
    },
  });
  assignedAppointmentId = assigned.id;

  const unassigned = await prisma.appointment.create({
    data: {
      reference: `APT-${RUN_ID}-U`,
      studentProfileId,
      type: 'INITIAL_CONSULTATION',
      status: 'REQUESTED',
      startsAt: new Date(Date.now() + 2 * 86_400_000),
    },
  });
  unassignedAppointmentId = unassigned.id;
});

afterAll(async () => {
  await prisma.appointment.deleteMany({ where: { reference: { contains: RUN_ID } } });
  await prisma.invoice.deleteMany({ where: { number: { contains: RUN_ID } } });
  await prisma.user.deleteMany({ where: { email: { contains: RUN_ID } } });
  await prisma.$disconnect();
});

describe('invoice endpoints are scoped to the assigned counsellor', () => {
  it("another counsellor cannot view, send, record a payment on, or remind about this student's invoice", async () => {
    const cookies = await loginAs(COUNSELLOR_B_EMAIL);

    const show = await request(app).get(`/admin/invoices/${invoiceId}`).set('Cookie', cookies);
    expect(show.status).toBe(403);

    // Can't fetch a fresh token from the invoice's own page — it 403s for
    // counsellor B, same as `show` above — so use a page they *can* reach.
    const { cookies: c2, csrfToken: t2 } = await freshCsrf(cookies, '/admin/invoices/new');
    const send = await request(app)
      .post(`/admin/invoices/${invoiceId}/send`)
      .set('Cookie', c2)
      .type('form')
      .send({ _csrf: t2 });
    expect(send.status).toBe(403);

    const recordPayment = await request(app)
      .post(`/admin/invoices/${invoiceId}/record-payment`)
      .set('Cookie', c2)
      .type('form')
      .send({ method: 'BANK_TRANSFER', amountMinor: '10000', _csrf: t2 });
    expect(recordPayment.status).toBe(403);

    const remind = await request(app)
      .post(`/admin/invoices/${invoiceId}/remind`)
      .set('Cookie', c2)
      .type('form')
      .send({ _csrf: t2 });
    expect(remind.status).toBe(403);
  }, 30_000);

  it('the assigned counsellor can view the invoice', async () => {
    const cookies = await loginAs(COUNSELLOR_A_EMAIL);
    const show = await request(app).get(`/admin/invoices/${invoiceId}`).set('Cookie', cookies);
    expect(show.status).toBe(200);
  }, 15_000);
});

describe('appointment endpoints are scoped to the hosting counsellor', () => {
  it('another counsellor cannot reschedule, cancel, or complete an appointment assigned to a different counsellor', async () => {
    const cookies = await loginAs(COUNSELLOR_B_EMAIL);

    const { cookies: c2, csrfToken: t2 } = await freshCsrf(cookies, '/admin/appointments');

    const reschedule = await request(app)
      .post(`/admin/appointments/${assignedAppointmentId}/reschedule`)
      .set('Cookie', c2)
      .type('form')
      .send({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), _csrf: t2 });
    expect(reschedule.status).toBe(403);

    const cancel = await request(app)
      .post(`/admin/appointments/${assignedAppointmentId}/cancel`)
      .set('Cookie', c2)
      .type('form')
      .send({ _csrf: t2 });
    expect(cancel.status).toBe(403);

    const complete = await request(app)
      .post(`/admin/appointments/${assignedAppointmentId}/complete`)
      .set('Cookie', c2)
      .type('form')
      .send({ _csrf: t2 });
    expect(complete.status).toBe(403);
  }, 30_000);

  it('any counsellor can confirm a not-yet-assigned appointment, claiming it', async () => {
    const cookies = await loginAs(COUNSELLOR_B_EMAIL);
    const { cookies: c2, csrfToken: t2 } = await freshCsrf(cookies, '/admin/appointments');

    const confirm = await request(app)
      .post(`/admin/appointments/${unassignedAppointmentId}/confirm`)
      .set('Cookie', c2)
      .type('form')
      .send({ _csrf: t2 });

    expect(confirm.status).toBe(303);

    const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: unassignedAppointmentId } });
    expect(updated.counsellorId).toBe(counsellorBId);
    expect(updated.status).toBe('CONFIRMED');
  }, 15_000);

  it('the assigned counsellor can cancel their own appointment', async () => {
    const cookies = await loginAs(COUNSELLOR_A_EMAIL);
    const { cookies: c2, csrfToken: t2 } = await freshCsrf(cookies, '/admin/appointments');

    const cancel = await request(app)
      .post(`/admin/appointments/${assignedAppointmentId}/cancel`)
      .set('Cookie', c2)
      .type('form')
      .send({ _csrf: t2 });

    expect(cancel.status).toBe(303);
  }, 15_000);
});
