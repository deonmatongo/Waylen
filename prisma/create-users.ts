import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await argon2.hash('123456789', { type: argon2.argon2id });

  const users = [
    {
      email: 'admin@waylen.com',
      fullName: 'Admin User',
      role: 'SUPER_ADMIN' as const,
      staffProfile: { jobTitle: 'Administrator' },
    },
    {
      email: 'counselor@waylen.com',
      fullName: 'Counselor User',
      role: 'COUNSELLOR' as const,
      staffProfile: { jobTitle: 'Education Counsellor' },
    },
  ];

  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });

    if (existing) {
      await prisma.user.update({
        where: { email: u.email },
        data: { passwordHash, fullName: u.fullName, role: u.role, status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      console.log(`Updated: ${u.email}`);
    } else {
      await prisma.user.create({
        data: {
          email: u.email,
          fullName: u.fullName,
          passwordHash,
          role: u.role,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          staffProfile: { create: { jobTitle: u.staffProfile.jobTitle, regions: '[]' } },
        },
      });
      console.log(`Created: ${u.email}`);
    }
  }

  // Student
  const studentEmail = 'student@waylen.com';
  const existingStudent = await prisma.user.findUnique({ where: { email: studentEmail } });

  if (existingStudent) {
    await prisma.user.update({
      where: { email: studentEmail },
      data: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
    console.log(`Updated: ${studentEmail}`);
  } else {
    await prisma.user.create({
      data: {
        email: studentEmail,
        fullName: 'Student User',
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        studentProfile: {
          create: {
            reference: `WYL-STU-NEW001`,
          },
        },
      },
    });
    console.log(`Created: ${studentEmail}`);
  }

  console.log('\nDone. Sign in with password: 123456789\n');
  console.log('  Admin      admin@waylen.com');
  console.log('  Counselor  counselor@waylen.com');
  console.log('  Student    student@waylen.com');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => void prisma.$disconnect());
