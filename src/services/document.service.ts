/**
 * Document Centre (PRD §5.2, §5.4, §8.2).
 *
 * Covers both directions of the document flow:
 *   • students upload identity and academic paperwork for staff review;
 *   • staff issue offer letters, acceptance letters and visa support letters
 *     onto a student's file, with the student notified automatically — the
 *     "key operational requirement" in PRD §5.4.
 */
import type { DocumentType, DocumentStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { DOCUMENT_TYPE_LABELS, STUDENT_UPLOAD_DOCUMENT_TYPES } from '../config/constants.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { storageService } from './storage.service.js';
import { notificationService } from './notification.service.js';
import { auditService } from './audit.service.js';

export interface RetrievedDocument {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export const documentService = {
  /** Student-initiated upload. Lands as UNDER_REVIEW for staff triage. */
  async uploadForStudent(input: {
    studentProfileId: string;
    uploadedById: string;
    type: DocumentType;
    file: Express.Multer.File;
    applicationId?: string;
  }) {
    if (!STUDENT_UPLOAD_DOCUMENT_TYPES.includes(input.type)) {
      throw new ValidationError('That document type cannot be uploaded here.');
    }

    const stored = await storageService.store(input.file.buffer, {
      studentProfileId: input.studentProfileId,
      originalFilename: input.file.originalname,
    });

    const document = await prisma.document.create({
      data: {
        studentProfileId: input.studentProfileId,
        applicationId: input.applicationId ?? null,
        type: input.type,
        status: 'UNDER_REVIEW',
        originalFilename: input.file.originalname,
        storageKey: stored.storageKey,
        mimeType: input.file.mimetype,
        sizeBytes: stored.sizeBytes,
        checksumSha256: stored.checksumSha256,
        encryptionIv: stored.iv,
        uploadedById: input.uploadedById,
        isIssuedByWaylen: false,
      },
    });

    logger.info(
      { documentId: document.id, type: input.type, studentProfileId: input.studentProfileId },
      'Student document uploaded',
    );

    return document;
  },

  /**
   * Staff-issued document (PRD §5.4). Marked `isIssuedByWaylen` so it appears
   * under Downloads rather than in the review queue, and is pre-approved.
   */
  async issueToStudent(input: {
    studentProfileId: string;
    issuedById: string;
    type: DocumentType;
    file: Express.Multer.File;
    applicationId?: string;
    partnerId?: string;
    note?: string;
  }) {
    const stored = await storageService.store(input.file.buffer, {
      studentProfileId: input.studentProfileId,
      originalFilename: input.file.originalname,
    });

    const document = await prisma.document.create({
      data: {
        studentProfileId: input.studentProfileId,
        applicationId: input.applicationId ?? null,
        partnerId: input.partnerId ?? null,
        type: input.type,
        status: 'APPROVED',
        originalFilename: input.file.originalname,
        storageKey: stored.storageKey,
        mimeType: input.file.mimetype,
        sizeBytes: stored.sizeBytes,
        checksumSha256: stored.checksumSha256,
        encryptionIv: stored.iv,
        uploadedById: input.issuedById,
        reviewedById: input.issuedById,
        reviewedAt: new Date(),
        reviewNotes: input.note ?? null,
        isIssuedByWaylen: true,
      },
      include: { studentProfile: { select: { userId: true } } },
    });

    await auditService.record({
      actorId: input.issuedById,
      action: 'CREATE',
      entity: 'Document',
      entityId: document.id,
      studentProfileId: input.studentProfileId,
      changes: { type: input.type, issued: true },
    });

    // The automatic notification the PRD calls for.
    await notificationService.dispatch({
      userId: document.studentProfile.userId,
      event: 'document.issued',
      title: `${DOCUMENT_TYPE_LABELS[input.type]} is now available`,
      body: input.note ?? 'A new document has been added to your account and is ready to download.',
      actionUrl: '/portal/downloads',
      emailTemplate: 'document-issued',
      emailData: { documentLabel: DOCUMENT_TYPE_LABELS[input.type] },
    });

    logger.info({ documentId: document.id, type: input.type }, 'Document issued to student');
    return document;
  },

  /** Staff review decision (PRD §5.4). */
  async review(input: {
    documentId: string;
    reviewerId: string;
    status: Extract<DocumentStatus, 'APPROVED' | 'NEEDS_CORRECTION'>;
    notes?: string;
  }) {
    const existing = await prisma.document.findUnique({
      where: { id: input.documentId },
      select: {
        id: true,
        type: true,
        status: true,
        studentProfileId: true,
        isIssuedByWaylen: true,
        studentProfile: { select: { userId: true } },
      },
    });

    if (!existing) throw new NotFoundError('That document could not be found.');
    if (existing.isIssuedByWaylen) {
      throw new ValidationError('Documents issued by Waylen are not part of the review queue.');
    }
    if (input.status === 'NEEDS_CORRECTION' && !input.notes?.trim()) {
      // A correction request without a reason is not actionable for the student.
      throw new ValidationError('Please explain what the student needs to correct.');
    }

    const document = await prisma.document.update({
      where: { id: input.documentId },
      data: {
        status: input.status,
        reviewedById: input.reviewerId,
        reviewedAt: new Date(),
        reviewNotes: input.notes ?? null,
      },
    });

    await auditService.record({
      actorId: input.reviewerId,
      action: 'UPDATE',
      entity: 'Document',
      entityId: document.id,
      studentProfileId: existing.studentProfileId,
      changes: { status: { from: existing.status, to: input.status } },
    });

    const approved = input.status === 'APPROVED';
    await notificationService.dispatch({
      userId: existing.studentProfile.userId,
      event: approved ? 'document.approved' : 'document.needs_correction',
      title: approved
        ? `${DOCUMENT_TYPE_LABELS[existing.type]} approved`
        : `${DOCUMENT_TYPE_LABELS[existing.type]} needs correction`,
      body: input.notes ?? undefined,
      actionUrl: '/portal/documents',
      emailTemplate: approved ? 'document-approved' : 'document-correction',
      emailData: { documentLabel: DOCUMENT_TYPE_LABELS[existing.type], notes: input.notes },
    });

    return document;
  },

  /**
   * Decrypts a document for an authorised download. Access must already have
   * been checked by the caller via `assertCanAccessStudent`.
   */
  async retrieve(documentId: string): Promise<RetrievedDocument> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        originalFilename: true,
        mimeType: true,
        storageKey: true,
        checksumSha256: true,
      },
    });

    if (!document) throw new NotFoundError('That document could not be found.');

    const buffer = await storageService.retrieve(document.storageKey, document.checksumSha256);

    return {
      buffer,
      filename: document.originalFilename,
      mimeType: document.mimeType,
    };
  },

  /**
   * Students may withdraw a document only while it is still actionable —
   * anything already approved forms part of the application record.
   */
  async deleteForStudent(documentId: string, studentProfileId: string): Promise<void> {
    const document = await prisma.document.findFirst({
      where: { id: documentId, studentProfileId, isIssuedByWaylen: false },
      select: { id: true, status: true, storageKey: true },
    });

    if (!document) throw new NotFoundError('That document could not be found.');
    if (document.status === 'APPROVED') {
      throw new ValidationError(
        'Approved documents cannot be removed. Please message your counsellor if something needs to change.',
      );
    }

    await prisma.document.delete({ where: { id: document.id } });
    await storageService.remove(document.storageKey);
  },

  async listForStudent(studentProfileId: string, options: { issuedByWaylen?: boolean } = {}) {
    return prisma.document.findMany({
      where: {
        studentProfileId,
        ...(options.issuedByWaylen !== undefined
          ? { isIssuedByWaylen: options.issuedByWaylen }
          : {}),
      },
      select: {
        id: true,
        type: true,
        status: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        reviewNotes: true,
        reviewedAt: true,
        expiresAt: true,
        isIssuedByWaylen: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** The staff review queue, oldest first so nothing is left waiting. */
  async listReviewQueue(options: { counsellorId?: string; limit?: number } = {}) {
    return prisma.document.findMany({
      where: {
        status: 'UNDER_REVIEW',
        isIssuedByWaylen: false,
        ...(options.counsellorId
          ? { studentProfile: { assignedCounsellorId: options.counsellorId } }
          : {}),
      },
      select: {
        id: true,
        type: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        studentProfile: {
          select: {
            id: true,
            reference: true,
            user: { select: { fullName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: options.limit ?? 100,
    });
  },

  /**
   * Which of the expected documents a student still owes. Drives the
   * "outstanding actions" panel on the dashboard (PRD §5.2).
   */
  async outstandingRequirements(studentProfileId: string): Promise<DocumentType[]> {
    const required: DocumentType[] = [
      'PASSPORT',
      'ACADEMIC_TRANSCRIPT',
      'DEGREE_CERTIFICATE',
      'CV',
      'ENGLISH_PROFICIENCY',
    ];

    const held = await prisma.document.findMany({
      where: {
        studentProfileId,
        isIssuedByWaylen: false,
        status: { in: ['UNDER_REVIEW', 'APPROVED'] },
      },
      select: { type: true },
    });

    const heldTypes = new Set(held.map((d) => d.type));
    return required.filter((type) => !heldTypes.has(type));
  },
};
