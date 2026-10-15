/**
 * Data-subject tooling (GDPR Art. 15 access / Art. 17 erasure).
 *
 * Erasure is anonymisation, never a hard delete: Invoice and Payment rows are
 * `onDelete: Restrict` against the student (financial records must survive),
 * and Message/SupportTicketMessage restrict against their sender. Replacing
 * the PII on the User row satisfies erasure while leaving those intact.
 */
import { prisma } from '../config/database.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

export interface ExportedUserData {
  exportedAt: string;
  profile: unknown;
  applications: unknown[];
  documents: unknown[];
  appointments: unknown[];
  invoices: unknown[];
  messages: unknown[];
  tickets: unknown[];
  notifications: unknown[];
}

/** Unusable bcrypt/argon-shaped value: matches no password, verifies as false. */
const UNUSABLE_PASSWORD_HASH = '!anonymised';

export const privacyService = {
  /**
   * Everything we hold about one user, as plain JSON. Storage keys, IVs,
   * password hash, MFA secret, tokens and staff-only (internal) notes are
   * deliberately excluded.
   */
  async exportUserData(userId: string): Promise<ExportedUserData> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        studentProfile: {
          select: {
            id: true,
            reference: true,
            dateOfBirth: true,
            city: true,
            preferredStudyLevel: true,
            preferredCourses: true,
            currentStage: true,
            createdAt: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundError('User not found.');

    const { studentProfile, ...account } = user;
    const profileId = studentProfile?.id;

    const none = Promise.resolve([] as unknown[]);

    const [applications, documents, appointments, invoices, messages, tickets, notifications] =
      await Promise.all([
        profileId
          ? prisma.application.findMany({
              where: { studentProfileId: profileId },
              select: {
                reference: true,
                programmeName: true,
                studyLevel: true,
                intakePeriod: true,
                stage: true,
                outcome: true,
                submittedAt: true,
                decisionAt: true,
                studentNotes: true,
                applicationDeadline: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'asc' },
            })
          : none,
        profileId
          ? prisma.document.findMany({
              where: { studentProfileId: profileId },
              // No storageKey / encryptionIv: metadata only.
              select: {
                id: true,
                type: true,
                status: true,
                originalFilename: true,
                mimeType: true,
                sizeBytes: true,
                checksumSha256: true,
                isIssuedByWaylen: true,
                expiresAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'asc' },
            })
          : none,
        profileId
          ? prisma.appointment.findMany({
              where: { studentProfileId: profileId },
              select: {
                reference: true,
                type: true,
                status: true,
                format: true,
                startsAt: true,
                durationMinutes: true,
                timezone: true,
                location: true,
                studentNotes: true,
                createdAt: true,
              },
              orderBy: { startsAt: 'asc' },
            })
          : none,
        profileId
          ? prisma.invoice.findMany({
              where: { studentProfileId: profileId },
              select: {
                number: true,
                status: true,
                currency: true,
                subtotalMinor: true,
                taxMinor: true,
                totalMinor: true,
                paidMinor: true,
                description: true,
                issuedAt: true,
                dueAt: true,
                paidAt: true,
                lineItems: {
                  select: { description: true, quantity: true, unitPriceMinor: true, totalMinor: true },
                },
                payments: {
                  select: {
                    method: true,
                    status: true,
                    amountMinor: true,
                    currency: true,
                    provider: true,
                    providerReference: true,
                    paidAt: true,
                    createdAt: true,
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
            })
          : none,
        profileId
          ? prisma.message.findMany({
              // Staff-only notes are not the student's data.
              where: { isInternal: false, thread: { studentProfileId: profileId } },
              select: { threadId: true, senderId: true, body: true, readAt: true, createdAt: true },
              orderBy: { createdAt: 'asc' },
            })
          : none,
        profileId
          ? prisma.supportTicket.findMany({
              where: { studentProfileId: profileId },
              select: {
                reference: true,
                category: true,
                subject: true,
                status: true,
                resolvedAt: true,
                createdAt: true,
                messages: {
                  where: { isInternal: false },
                  select: { senderId: true, body: true, createdAt: true },
                  orderBy: { createdAt: 'asc' },
                },
              },
              orderBy: { createdAt: 'asc' },
            })
          : none,
        prisma.notification.findMany({
          where: { userId },
          select: { channel: true, eventKey: true, title: true, body: true, readAt: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      profile: { ...account, studentProfile },
      applications,
      documents,
      appointments,
      invoices,
      messages,
      tickets,
      notifications,
    };
  },

  /**
   * Replaces the user's PII and closes the account. Idempotent: an already
   * anonymised account is returned unchanged. Financial records are untouched.
   */
  async anonymiseUser(userId: string, actorId: string): Promise<{ alreadyAnonymised: boolean }> {
    if (userId === actorId) throw new ForbiddenError('You cannot anonymise your own account.');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true, email: true, studentProfile: { select: { id: true } } },
    });
    if (!user) throw new NotFoundError('User not found.');
    if (user.role === 'SUPER_ADMIN') throw new ForbiddenError('Super admin accounts cannot be anonymised.');

    const anonymisedEmail = `deleted-${user.id}@invalid`;
    if (user.email === anonymisedEmail) return { alreadyAnonymised: true };

    const now = new Date();
    const profileId = user.studentProfile?.id;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          email: anonymisedEmail,
          fullName: 'Deleted user',
          phone: null,
          passwordHash: UNUSABLE_PASSWORD_HASH,
          passwordChangedAt: now,
          verificationToken: null,
          verificationExpiresAt: null,
          passwordResetToken: null,
          passwordResetExpiresAt: null,
          mfaEnabled: false,
          mfaSecret: null,
          status: 'ARCHIVED',
        },
      });

      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });

      if (profileId) {
        await tx.studentProfile.update({ where: { id: profileId }, data: { dateOfBirth: null, city: null } });
        // CRM enquiries linked to this student carry the same contact PII.
        await tx.enquiry.updateMany({
          where: { studentProfileId: profileId },
          data: { fullName: 'Deleted user', email: anonymisedEmail, phone: null, message: null },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId,
          action: 'ANONYMISE',
          entity: 'User',
          entityId: user.id,
          studentProfileId: profileId ?? null,
        },
      });
    });

    return { alreadyAnonymised: false };
  },
};
