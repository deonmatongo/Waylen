/**
 * Counsellor scoping for the CRM and support queues, and for the student
 * list's `?counsellor=` filter.
 *
 * A counsellor may only see enquiries / tickets assigned to them or belonging
 * to one of their assigned students, and a user-supplied `?counsellor=` filter
 * must never widen the student list beyond their own caseload. Assignment
 * targets must be active staff. Needs a real database; every record carries
 * RUN_ID so afterAll can clean up precisely.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';

let app: Express;
let prisma: PrismaClient;

const RUN_ID = `crm-scope-${Date.now()}`;
const COUNSELLOR_A_EMAIL = `${RUN_ID}-counsellor-a@example.com`;
const COUNSELLOR_B_EMAIL = `${RUN_ID}-counsellor-b@example.com`;
const STUDENT_A_EMAIL = `${RUN_ID}-student-a@example.com`;
const STUDENT_B_EMAIL = `${RUN_ID}-student-b@example.com`;
const PASSWORD = 'Str0ngPassw0rd!';

let counsellorAId = '';
let counsellorBId = '';
let studentAProfileId = '';
let studentBProfileId = '';
let studentAId = '';
let ownEnquiryId = '';
let foreignEnquiryId = '';
let ownTicketId = '';
let foreignTicketId = '';

function toPairs(cookieHeader: string): Map<string, string> {
  if (!cookieHeader) return new Map();
  return new Map(
    cookieHeader
      .split('; ')
      .filter(Boolean)
      .map((pair) => [pair.split('=')[0]!, pair]),
  );
}

function mergeCookies(existing: string, res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  if (!setCookie) return existing;
  const pairs = toPairs(existing);
  for (const raw of setCookie) {
    const pair = raw.split(';')[0]!;
    pairs.set(pair.split('=')[0]!, pair);
  }
  return [...pairs.values()].join('; ');
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
  return { cookies: mergeCookies(cookies, res), csrfToken: extractCsrfToken(res.text) };
}

beforeAll(async () => {
  const appModule = await import('../../src/app.js');
  const dbModule = await import('../../src/config/database.js');
  const { hashPassword } = await import('../../src/utils/crypto.js');
  const { studentReference, ticketReference } = await import('../../src/utils/reference.js');

  app = appModule.createApp();
  prisma = dbModule.prisma;
  const passwordHash = await hashPassword(PASSWORD);

  const makeCounsellor = (email: string, name: string) =>
    prisma.user.create({
      data: { email, fullName: name, passwordHash, role: 'COUNSELLOR', status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
  counsellorAId = (await makeCounsellor(COUNSELLOR_A_EMAIL, 'CRM Counsellor A')).id;
  counsellorBId = (await makeCounsellor(COUNSELLOR_B_EMAIL, 'CRM Counsellor B')).id;

  const makeStudent = (email: string, name: string, counsellorId: string) =>
    prisma.user.create({
      data: {
        email,
        fullName: name,
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        studentProfile: { create: { reference: studentReference(), assignedCounsellorId: counsellorId } },
      },
      include: { studentProfile: true },
    });
  const studentA = await makeStudent(STUDENT_A_EMAIL, 'CRM Student A', counsellorAId);
  const studentB = await makeStudent(STUDENT_B_EMAIL, 'CRM Student B', counsellorBId);
  studentAId = studentA.id;
  studentAProfileId = studentA.studentProfile!.id;
  studentBProfileId = studentB.studentProfile!.id;

  // Counsellor A's own: one tied to their student, one assigned directly.
  ownEnquiryId = (
    await prisma.enquiry.create({
      data: { fullName: `${RUN_ID} own`, email: `${RUN_ID}-own@example.com`, studentProfileId: studentAProfileId },
    })
  ).id;
  foreignEnquiryId = (
    await prisma.enquiry.create({
      data: { fullName: `${RUN_ID} foreign`, email: `${RUN_ID}-foreign@example.com`, studentProfileId: studentBProfileId },
    })
  ).id;

  ownTicketId = (
    await prisma.supportTicket.create({
      data: {
        reference: ticketReference(),
        studentProfileId: studentAProfileId,
        category: 'OTHER',
        subject: `${RUN_ID} own ticket`,
      },
    })
  ).id;
  foreignTicketId = (
    await prisma.supportTicket.create({
      data: {
        reference: ticketReference(),
        studentProfileId: studentBProfileId,
        category: 'OTHER',
        subject: `${RUN_ID} foreign ticket`,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.supportTicket.deleteMany({ where: { subject: { contains: RUN_ID } } });
  await prisma.enquiry.deleteMany({ where: { email: { contains: RUN_ID } } });
  await prisma.user.deleteMany({ where: { email: { contains: RUN_ID } } });
  await prisma.$disconnect();
});

describe('enquiries are scoped to the counsellor', () => {
  it('lists only enquiries for their own students', async () => {
    const cookies = await loginAs(COUNSELLOR_A_EMAIL);
    const res = await request(app).get('/admin/enquiries').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`${RUN_ID} own`);
    expect(res.text).not.toContain(`${RUN_ID} foreign`);
  }, 15_000);

  it("blocks viewing, updating or reassigning another counsellor's enquiry", async () => {
    const cookies = await loginAs(COUNSELLOR_A_EMAIL);

    const show = await request(app).get(`/admin/enquiries/${foreignEnquiryId}`).set('Cookie', cookies);
    expect(show.status).toBe(403);

    const { cookies: c2, csrfToken } = await freshCsrf(cookies, '/admin/enquiries');
    const status = await request(app)
      .post(`/admin/enquiries/${foreignEnquiryId}/status`)
      .set('Cookie', c2)
      .type('form')
      .send({ status: 'CONTACTED', _csrf: csrfToken });
    expect(status.status).toBe(403);

    const assign = await request(app)
      .post(`/admin/enquiries/${foreignEnquiryId}/assign`)
      .set('Cookie', c2)
      .type('form')
      .send({ assignedToId: counsellorAId, _csrf: csrfToken });
    expect(assign.status).toBe(403);

    const unchanged = await prisma.enquiry.findUniqueOrThrow({ where: { id: foreignEnquiryId } });
    expect(unchanged.assignedToId).toBeNull();
  }, 30_000);

  it('rejects an assignment target that is not active staff', async () => {
    const cookies = await loginAs(COUNSELLOR_A_EMAIL);
    const { cookies: c2, csrfToken } = await freshCsrf(cookies, '/admin/enquiries');

    const assign = await request(app)
      .post(`/admin/enquiries/${ownEnquiryId}/assign`)
      .set('Cookie', c2)
      .type('form')
      .send({ assignedToId: studentAId, _csrf: csrfToken });
    expect(assign.status).toBe(303);

    const unchanged = await prisma.enquiry.findUniqueOrThrow({ where: { id: ownEnquiryId } });
    expect(unchanged.assignedToId).toBeNull();
  }, 15_000);
});

describe('support tickets are scoped to the counsellor', () => {
  it('lists only tickets for their own students', async () => {
    const cookies = await loginAs(COUNSELLOR_A_EMAIL);
    const res = await request(app).get('/admin/support').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`${RUN_ID} own ticket`);
    expect(res.text).not.toContain(`${RUN_ID} foreign ticket`);
  }, 15_000);

  it("blocks viewing, replying to, or changing another counsellor's ticket", async () => {
    const cookies = await loginAs(COUNSELLOR_A_EMAIL);

    const show = await request(app).get(`/admin/support/${foreignTicketId}`).set('Cookie', cookies);
    expect(show.status).toBe(403);

    const { cookies: c2, csrfToken } = await freshCsrf(cookies, '/admin/support');
    const reply = await request(app)
      .post(`/admin/support/${foreignTicketId}/reply`)
      .set('Cookie', c2)
      .type('form')
      .send({ body: 'hello', _csrf: csrfToken });
    expect(reply.status).toBe(403);

    const status = await request(app)
      .post(`/admin/support/${foreignTicketId}/status`)
      .set('Cookie', c2)
      .type('form')
      .send({ status: 'RESOLVED', _csrf: csrfToken });
    expect(status.status).toBe(403);

    const assign = await request(app)
      .post(`/admin/support/${foreignTicketId}/assign`)
      .set('Cookie', c2)
      .type('form')
      .send({ assignedToId: counsellorAId, _csrf: csrfToken });
    expect(assign.status).toBe(403);

    const unchanged = await prisma.supportTicket.findUniqueOrThrow({ where: { id: foreignTicketId } });
    expect(unchanged.status).toBe('OPEN');
    expect(unchanged.assignedToId).toBeNull();
  }, 30_000);

  it('the counsellor can open a ticket raised by their own student', async () => {
    const cookies = await loginAs(COUNSELLOR_A_EMAIL);
    const show = await request(app).get(`/admin/support/${ownTicketId}`).set('Cookie', cookies);
    expect(show.status).toBe(200);
  }, 15_000);
});

describe('student list ?counsellor= filter cannot widen a counsellor\'s scope', () => {
  it("does not reveal another counsellor's students", async () => {
    const cookies = await loginAs(COUNSELLOR_A_EMAIL);
    const res = await request(app)
      .get(`/admin/students?counsellor=${counsellorBId}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('CRM Student B');
    expect(res.text).not.toContain('CRM Student A');
  }, 15_000);

  it('still lists their own students without the filter', async () => {
    const cookies = await loginAs(COUNSELLOR_A_EMAIL);
    const res = await request(app).get('/admin/students').set('Cookie', cookies);
    expect(res.text).toContain('CRM Student A');
    expect(res.text).not.toContain('CRM Student B');
  }, 15_000);
});
