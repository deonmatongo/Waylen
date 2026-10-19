/**
 * Contracts & Agreements (client navigation feedback) — consultancy/service
 * agreements with a signature lifecycle, distinct from the document review
 * workflow. Storage is shared with Document via `storageService`; the two
 * models are otherwise unrelated.
 */
import type { ContractStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { storageService } from './storage.service.js';
import { notificationService } from './notification.service.js';
import { auditService } from './audit.service.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

export interface RetrievedContract {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * Allowed lifecycle moves. Contracts go forward (signed, then active) and can
 * be cancelled or expire; CANCELLED and EXPIRED are terminal. Anything not
 * listed (including no-op same-status moves) is rejected.
 * Typed as a full Record so adding a ContractStatus fails to compile until
 * its transitions and copy are defined here.
 */
export const CONTRACT_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  AWAITING_SIGNATURE: ['SIGNED', 'CANCELLED', 'EXPIRED'],
  SIGNED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['EXPIRED', 'CANCELLED'],
  CANCELLED: [],
  EXPIRED: [],
};

/** Only live agreements are offered for signing or download as current. */
export function isContractLive(status: ContractStatus): boolean {
  return status !== 'CANCELLED' && status !== 'EXPIRED';
}

export function canTransitionContract(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Student-facing wording per status, so copy never claims the wrong state. */
const STATUS_COPY: Record<ContractStatus, string> = {
  AWAITING_SIGNATURE: 'awaiting your signature',
  SIGNED: 'signed',
  ACTIVE: 'active',
  CANCELLED: 'cancelled and no longer needs your signature',
  EXPIRED: 'expired',
};

export function contractStatusTitle(title: string, status: ContractStatus): string {
  return `${title} is now ${STATUS_COPY[status] ?? `marked ${String(status).toLowerCase().replace(/_/g, ' ')}`}`;
}

export const contractService = {
  /** Staff-issued contract, landing as AWAITING_SIGNATURE. */
  async issueToStudent(input: {
    studentProfileId: string;
    createdById: string;
    title: string;
    file: Express.Multer.File;
  }) {
    const stored = await storageService.store(input.file.buffer, {
      studentProfileId: input.studentProfileId,
      originalFilename: input.file.originalname,
    });

    const contract = await prisma.contract.create({
      data: {
        studentProfileId: input.studentProfileId,
        title: input.title,
        status: 'AWAITING_SIGNATURE',
        originalFilename: input.file.originalname,
        storageKey: stored.storageKey,
        mimeType: input.file.mimetype,
        sizeBytes: stored.sizeBytes,
        checksumSha256: stored.checksumSha256,
        encryptionIv: stored.iv,
        createdById: input.createdById,
      },
      include: { studentProfile: { select: { userId: true } } },
    });

    await auditService.record({
      actorId: input.createdById,
      action: 'CREATE',
      entity: 'Contract',
      entityId: contract.id,
      studentProfileId: input.studentProfileId,
      changes: { title: input.title },
    });

    // No `emailTemplate` — the generic template already renders title/body/
    // actionUrl, and this doesn't need bespoke copy the way an offer letter does.
    await notificationService.dispatch({
      userId: contract.studentProfile.userId,
      event: 'contract.issued',
      title: `${input.title} is ready for signature`,
      body: 'A new agreement has been added to your account.',
      actionUrl: '/portal/contracts',
    });

    logger.info({ contractId: contract.id, studentProfileId: input.studentProfileId }, 'Contract issued to student');
    return contract;
  },

  /** Staff moves a contract through its signature lifecycle. */
  async updateStatus(input: { contractId: string; status: ContractStatus; actorId: string }) {
    const existing = await prisma.contract.findUnique({
      where: { id: input.contractId },
      select: { id: true, status: true, studentProfileId: true, title: true, studentProfile: { select: { userId: true } } },
    });
    if (!existing) throw new NotFoundError('That contract could not be found.');

    if (!canTransitionContract(existing.status, input.status)) {
      throw new ValidationError(
        `A contract that is ${existing.status.toLowerCase().replace(/_/g, ' ')} cannot be moved to ${input.status.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }

    // Compare-and-set on the current status inside one transaction so two
    // concurrent moves cannot both apply, and signedAt is stamped atomically.
    // signedAt is only set on the first move into SIGNED (it stays null-guarded).
    const contract = await prisma.$transaction(async (tx) => {
      const moved = await tx.contract.updateMany({
        where: { id: input.contractId, status: existing.status },
        data: { status: input.status },
      });
      if (moved.count === 0) {
        throw new ValidationError('That contract was changed by someone else. Please refresh and try again.');
      }
      if (input.status === 'SIGNED') {
        await tx.contract.updateMany({
          where: { id: input.contractId, signedAt: null },
          data: { signedAt: new Date() },
        });
      }
      return tx.contract.findUniqueOrThrow({ where: { id: input.contractId } });
    });

    await auditService.record({
      actorId: input.actorId,
      action: 'UPDATE',
      entity: 'Contract',
      entityId: contract.id,
      studentProfileId: existing.studentProfileId,
      changes: { status: { from: existing.status, to: input.status } },
    });

    await notificationService.dispatch({
      userId: existing.studentProfile.userId,
      event: 'contract.status_changed',
      title: contractStatusTitle(existing.title, input.status),
      actionUrl: '/portal/contracts',
    });

    return contract;
  },

  async listForStudent(studentProfileId: string) {
    return prisma.contract.findMany({
      where: { studentProfileId },
      select: {
        id: true,
        title: true,
        status: true,
        originalFilename: true,
        sizeBytes: true,
        signedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async retrieve(contractId: string): Promise<RetrievedContract> {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { originalFilename: true, mimeType: true, storageKey: true, checksumSha256: true },
    });
    if (!contract) throw new NotFoundError('That contract could not be found.');

    const buffer = await storageService.retrieve(contract.storageKey, contract.checksumSha256);

    return { buffer, filename: contract.originalFilename, mimeType: contract.mimeType };
  },
};
