/* eslint-disable no-console -- CLI script: stdout is the interface */
/**
 * One-off bootstrap for the first real staff account (SUPER_ADMIN, or any
 * staff role). Replaces the old hardcoded-credential script.
 *
 *   ADMIN_EMAIL=you@company.com ADMIN_NAME="Your Name" ADMIN_ROLE=SUPER_ADMIN \
 *   CONFIRM_DB_HOST=<hostname of DATABASE_URL> npm run admin:create
 *
 * - Generates a random password and prints it ONCE; it is never stored in
 *   plaintext and never read from a file.
 * - Refuses to touch an existing account (it never overwrites a password).
 * - CONFIRM_DB_HOST must equal the host in DATABASE_URL so a script run from
 *   the wrong shell cannot silently write to the wrong database.
 */
import crypto from 'node:crypto';
import { PrismaClient, type UserRole } from '@prisma/client';
import argon2 from 'argon2';

const STAFF_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN_STAFF', 'COUNSELLOR'];

function generatePassword(length = 24): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_=+';
  const all = lower + upper + digits + symbols;
  const pick = (set: string) => set[crypto.randomInt(set.length)] as string;
  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (chars.length < length) chars.push(pick(all));
  // Fisher–Yates with a CSPRNG so the guaranteed characters are not predictable.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const fullName = process.env.ADMIN_NAME?.trim();
  const role = (process.env.ADMIN_ROLE ?? 'SUPER_ADMIN') as UserRole;
  const jobTitle = process.env.ADMIN_JOB_TITLE?.trim() || null;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Set ADMIN_EMAIL to a valid email address.');
  if (!fullName) throw new Error('Set ADMIN_NAME.');
  if (!STAFF_ROLES.includes(role)) throw new Error(`ADMIN_ROLE must be one of ${STAFF_ROLES.join(', ')}.`);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set.');
  const host = new URL(dbUrl).hostname;
  if (process.env.CONFIRM_DB_HOST !== host) {
    throw new Error(`Refusing to run: set CONFIRM_DB_HOST=${host} to confirm the target database.`);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new Error(`An account for ${email} already exists — not modifying it.`);

    const password = generatePassword();
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    const user = await prisma.user.create({
      data: {
        email,
        fullName,
        passwordHash,
        role,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        staffProfile: { create: { jobTitle, regions: '[]' } },
      },
      select: { id: true, email: true, role: true },
    });

    console.log(`\nCreated ${user.role} account on ${host}`);
    console.log(`  Email:    ${user.email}`);
    console.log(`  Password: ${password}`);
    console.log('\nStore this in a password manager now — it will not be shown again.');
    console.log('Sign in and change it, then enable 2FA when available.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
