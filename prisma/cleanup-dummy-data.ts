/* eslint-disable no-console -- CLI script: stdout is the interface */
/**
 * Removes the known placeholder/demo data that earlier seeds and audits left
 * in a database. DRY-RUN BY DEFAULT.
 *
 *   npx tsx prisma/cleanup-dummy-data.ts                    # print counts only
 *   npx tsx prisma/cleanup-dummy-data.ts --include-test-users
 *   CONFIRM_DB_HOST=<host of DATABASE_URL> \
 *     npx tsx prisma/cleanup-dummy-data.ts --commit [--include-test-users]
 *
 * Safety:
 * - Deletes only when BOTH --commit and CONFIRM_DB_HOST (== host of
 *   DATABASE_URL) are given.
 * - Matches ONLY the exact emails / slugs listed below. No bare
 *   `%@example.com` wildcard. Integration-test users (`<run-id>-...@example.com`,
 *   where run-id ends in a 13-digit timestamp) are listed separately and only
 *   touched with --include-test-users.
 * - Invoices are removed only when they belong to a dummy student, never
 *   just because a number like INV-2026-00001 matches (a real first invoice
 *   would carry the same number).
 * - Everything runs in ONE transaction; each deleteMany count must equal the
 *   count taken at the start of that transaction, else it rolls back.
 * - Aborts (nothing deleted) if a real student has a referral to a dummy
 *   partner, or a real invoice/payment hangs off a dummy student.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DUMMY_EMAILS = [
  'admin@waylen.com',
  'counselor@waylen.com',
  'student@waylen.com',
  'bee@waylen.example',
  'counsellor@waylen.example',
  'admin@waylen.example',
  'student@waylen.example',
];
/** Sample CRM enquiries from seed.ts (enquiries, not users). */
const DUMMY_ENQUIRY_EMAILS = ['nomsa.dube@example.com', 'emeka.nwosu@example.com'];
const DUMMY_PARTNER_SLUGS = [
  'europa-student-cover',
  'meridian-immigration-law',
  'atlas-education-finance',
  'partner-school-warsaw',
  'partner-school-dublin',
];
const DUMMY_OPPORTUNITY_SLUGS = [
  'bsc-computer-science-poland',
  'msc-international-business-ireland',
  'bsc-nursing-romania',
  'commercial-pilot-licence-latvia',
  'diploma-culinary-arts-bulgaria',
  'postgraduate-diploma-data-analytics-canada',
  'general-english-intensive-ireland',
  'ba-hospitality-management-lithuania',
];
const DUMMY_RESOURCE_SLUGS = [
  'how-to-write-a-motivation-letter',
  'student-visa-document-checklist',
  'budgeting-for-your-first-year-abroad',
  'building-credit-history-in-a-new-country',
  'country-pack-poland',
];
const DUMMY_TESTIMONIAL_AUTHORS = ['Chiedza M.', 'Kwame A.', 'Amara O.'];
const DUMMY_WEBINAR_SLUGS = [
  'how-to-study-in-poland',
  'scholarship-opportunities-in-ireland',
  'building-wealth-as-an-african-professional-abroad',
  'choosing-between-canada-and-the-eu',
];
/** Seed invoices; only removed when they belong to a dummy student. */
const DUMMY_INVOICE_NUMBER = /^INV-\d{4}-0000[12]$/;
/** `<label>-<13-digit ms timestamp>[-suffix]@example.com`, as made by tests/integration. */
const TEST_USER_REGEX = '^[a-z0-9-]+-[0-9]{13}(-[a-z0-9-]+)?@example\\.com$';

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function userIds(emails: string[]): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const includeTestUsers = process.argv.includes('--include-test-users');
  const host = hostOf(process.env.DATABASE_URL);

  console.log(`Database host: ${host ?? '(unparseable DATABASE_URL)'}`);
  console.log(commit ? 'Mode: COMMIT' : 'Mode: DRY RUN (nothing will be deleted)');
  if (commit && (!host || process.env.CONFIRM_DB_HOST !== host)) {
    throw new Error('Refusing to commit: CONFIRM_DB_HOST must equal the host of DATABASE_URL.');
  }

  const dummyUserIds = await userIds(DUMMY_EMAILS);
  let testUserIds: string[] = [];
  if (includeTestUsers) {
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      'SELECT id FROM users WHERE email ~ $1',
      TEST_USER_REGEX,
    );
    testUserIds = rows.map((r) => r.id);
  }
  const allUserIds = [...new Set([...dummyUserIds, ...testUserIds])];

  const profiles = await prisma.studentProfile.findMany({
    where: { userId: { in: allUserIds } },
    select: { id: true },
  });
  const profileIds = profiles.map((p) => p.id);

  const partners = await prisma.partner.findMany({
    where: { slug: { in: DUMMY_PARTNER_SLUGS } },
    select: { id: true },
  });
  const partnerIds = partners.map((p) => p.id);

  const invoices = await prisma.invoice.findMany({
    where: { studentProfileId: { in: profileIds } },
    select: { id: true, number: true },
  });
  const invoiceIds = invoices.map((i) => i.id);
  const seedNumberInvoices = invoices.filter((i) => DUMMY_INVOICE_NUMBER.test(i.number)).length;

  // Abort conditions: data that is not clearly dummy would be destroyed.
  const foreignReferrals = await prisma.referral.count({
    where: { partnerId: { in: partnerIds }, studentProfileId: { notIn: profileIds } },
  });
  if (foreignReferrals > 0) {
    throw new Error(`${foreignReferrals} referral(s) from non-dummy students point at dummy partners; resolve manually.`);
  }

  const plan = [
    ['users (exact dummy emails)', dummyUserIds.length],
    ['users (integration-test, --include-test-users)', testUserIds.length],
    ['student profiles (cascade)', profileIds.length],
    ['invoices of those students', invoiceIds.length],
    ['  of which match seed numbers INV-YYYY-00001/2', seedNumberInvoices],
    ['payments on those invoices', await prisma.payment.count({ where: { invoiceId: { in: invoiceIds } } })],
    ['messages sent by those users', await prisma.message.count({ where: { senderId: { in: allUserIds } } })],
    [
      'support ticket messages sent by those users',
      await prisma.supportTicketMessage.count({ where: { senderId: { in: allUserIds } } }),
    ],
    ['partners', partnerIds.length],
    ['referrals to those partners', await prisma.referral.count({ where: { partnerId: { in: partnerIds } } })],
    ['opportunities', await prisma.opportunity.count({ where: { slug: { in: DUMMY_OPPORTUNITY_SLUGS } } })],
    ['resources', await prisma.resource.count({ where: { slug: { in: DUMMY_RESOURCE_SLUGS } } })],
    ['testimonials', await prisma.testimonial.count({ where: { authorName: { in: DUMMY_TESTIMONIAL_AUTHORS } } })],
    ['webinars', await prisma.webinar.count({ where: { slug: { in: DUMMY_WEBINAR_SLUGS } } })],
    ['enquiries (sample CRM contacts)', await prisma.enquiry.count({ where: { email: { in: DUMMY_ENQUIRY_EMAILS } } })],
  ] as const;

  console.log(`\n${commit ? 'Will delete' : 'WOULD delete'}:`);
  for (const [label, count] of plan) console.log(`  ${String(count).padStart(5)}  ${label}`);

  if (!commit) {
    console.log('\nDry run only. Re-run with --commit and CONFIRM_DB_HOST to delete.');
    return;
  }

  const expect = (label: string, actual: number, expected: number): void => {
    if (actual !== expected) throw new Error(`Count mismatch for ${label}: deleted ${actual}, expected ${expected}`);
  };
  const planned = new Map<string, number>(plan.map(([label, count]) => [label, count]));

  await prisma.$transaction(async (tx) => {
    // FK-safe order: Restrict relations (payments -> invoices, messages,
    // referrals) first, then the rows that cascade from users/partners.
    expect('payments', (await tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } })).count, planned.get('payments on those invoices')!);
    expect('invoices', (await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } })).count, invoiceIds.length);
    expect('messages', (await tx.message.deleteMany({ where: { senderId: { in: allUserIds } } })).count, planned.get('messages sent by those users')!);
    expect(
      'ticket messages',
      (await tx.supportTicketMessage.deleteMany({ where: { senderId: { in: allUserIds } } })).count,
      planned.get('support ticket messages sent by those users')!,
    );
    expect('referrals', (await tx.referral.deleteMany({ where: { partnerId: { in: partnerIds } } })).count, planned.get('referrals to those partners')!);
    expect('users', (await tx.user.deleteMany({ where: { id: { in: allUserIds } } })).count, allUserIds.length);
    expect('partners', (await tx.partner.deleteMany({ where: { id: { in: partnerIds } } })).count, partnerIds.length);
    expect('opportunities', (await tx.opportunity.deleteMany({ where: { slug: { in: DUMMY_OPPORTUNITY_SLUGS } } })).count, planned.get('opportunities')!);
    expect('resources', (await tx.resource.deleteMany({ where: { slug: { in: DUMMY_RESOURCE_SLUGS } } })).count, planned.get('resources')!);
    expect('testimonials', (await tx.testimonial.deleteMany({ where: { authorName: { in: DUMMY_TESTIMONIAL_AUTHORS } } })).count, planned.get('testimonials')!);
    expect('webinars', (await tx.webinar.deleteMany({ where: { slug: { in: DUMMY_WEBINAR_SLUGS } } })).count, planned.get('webinars')!);
    expect('enquiries', (await tx.enquiry.deleteMany({ where: { email: { in: DUMMY_ENQUIRY_EMAILS } } })).count, planned.get('enquiries (sample CRM contacts)')!);
  });

  console.log('\nDone. Transaction committed.');
}

main()
  .catch((err) => {
    console.error('\nCleanup failed (nothing was deleted):\n', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
