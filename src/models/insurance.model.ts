/**
 * Insurance policy queries (PRD §5.2, §6.1).
 */
import { prisma } from '../config/database.js';

export async function listInsurancePoliciesForStudent(studentProfileId: string) {
  return prisma.insurancePolicy.findMany({
    where: { studentProfileId },
    select: {
      id: true,
      planName: true,
      policyNumber: true,
      coverageType: true,
      coverageStartsAt: true,
      coverageEndsAt: true,
      premiumMinor: true,
      currency: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}
