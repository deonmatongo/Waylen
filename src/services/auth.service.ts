/**
 * Registration, sign-in, verification and password reset (PRD §5.1).
 */
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { hashPassword, verifyPassword, generateToken } from '../utils/crypto.js';
import { studentReference } from '../utils/reference.js';
import { ConflictError, UnauthorizedError, ValidationError } from '../utils/errors.js';
import { mailService } from './mail.service.js';
import { notificationService } from './notification.service.js';

const VERIFICATION_TTL_HOURS = 48;
const RESET_TTL_MINUTES = 60;
/** Consecutive failures before the account is temporarily locked. */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  countryOfOriginIso?: string;
  preferredStudyLevel?: string;
  preferredCourses?: string[];
  preferredDestinationSlugs?: string[];
}

export const authService = {
  /**
   * Creates a student account and its profile in one transaction, then emails
   * a verification link. Portal access stays closed until it is used.
   */
  async register(input: RegisterInput) {
    const email = input.email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new ConflictError('An account already exists for that email address.');
    }

    const token = generateToken();
    const passwordHash = await hashPassword(input.password);

    const country = input.countryOfOriginIso
      ? await prisma.country.findUnique({
          where: { isoCode: input.countryOfOriginIso.toUpperCase() },
          select: { id: true },
        })
      : null;

    const destinations = input.preferredDestinationSlugs?.length
      ? await prisma.country.findMany({
          where: { slug: { in: input.preferredDestinationSlugs } },
          select: { id: true },
        })
      : [];

    const user = await prisma.user.create({
      data: {
        email,
        fullName: input.fullName.trim(),
        passwordHash,
        role: 'STUDENT',
        status: 'PENDING_VERIFICATION',
        verificationToken: token,
        verificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600_000),
        studentProfile: {
          create: {
            reference: studentReference(),
            countryOfOriginId: country?.id ?? null,
            preferredStudyLevel: (input.preferredStudyLevel as never) ?? null,
            preferredCourses: JSON.stringify(input.preferredCourses ?? []),
            ...(destinations.length
              ? { preferredDestinations: { connect: destinations.map((d) => ({ id: d.id })) } }
              : {}),
          },
        },
      },
      include: { studentProfile: { select: { id: true, reference: true } } },
    });

    await this.sendVerificationEmail(user.email, user.fullName, token);

    logger.info({ userId: user.id, reference: user.studentProfile?.reference }, 'Student registered');
    return user;
  },

  async sendVerificationEmail(email: string, fullName: string, token: string): Promise<void> {
    await mailService.send({
      to: email,
      subject: `Confirm your ${env.APP_NAME} account`,
      template: 'verify-email',
      data: {
        fullName,
        verifyUrl: `${env.APP_URL}/verify-email/${token}`,
        expiresInHours: VERIFICATION_TTL_HOURS,
      },
    });
  },

  /**
   * Authenticates a sign-in attempt.
   *
   * The same generic message is returned whether the email is unknown or the
   * password is wrong, so the response cannot be used to enumerate accounts.
   */
  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        fullName: true,
        passwordHash: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        failedLoginCount: true,
        failedLoginAt: true,
      },
    });

    const genericFailure = new UnauthorizedError('That email or password is not correct.');
    if (!user) throw genericFailure;

    if (user.status === 'SUSPENDED' || user.status === 'ARCHIVED') {
      throw new UnauthorizedError('That account is not currently active. Please contact us.');
    }

    // Temporary lockout after repeated failures.
    if (
      user.failedLoginCount >= MAX_FAILED_LOGINS &&
      user.failedLoginAt &&
      Date.now() - user.failedLoginAt.getTime() < LOCKOUT_MINUTES * 60_000
    ) {
      throw new UnauthorizedError(
        `Too many failed attempts. Please try again in ${LOCKOUT_MINUTES} minutes or reset your password.`,
      );
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: { increment: 1 },
          failedLoginAt: new Date(),
        },
      });
      throw genericFailure;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, failedLoginAt: null },
    });

    return user;
  },

  /** Consumes a verification token. Tokens are single-use and time-limited. */
  async verifyEmail(token: string) {
    const user = await prisma.user.findUnique({
      where: { verificationToken: token },
      select: { id: true, email: true, fullName: true, verificationExpiresAt: true },
    });

    if (!user) throw new ValidationError('That verification link is not valid.');
    if (!user.verificationExpiresAt || user.verificationExpiresAt < new Date()) {
      throw new ValidationError('That verification link has expired. Please request a new one.');
    }

    const verified = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
        verificationToken: null,
        verificationExpiresAt: null,
      },
      select: { id: true, email: true, fullName: true, role: true, status: true, emailVerifiedAt: true },
    });

    await notificationService.dispatch({
      userId: verified.id,
      event: 'account.verified',
      title: `Welcome to ${env.APP_NAME}`,
      body: 'Your account is confirmed. Your next step is to complete your profile and upload your documents.',
      actionUrl: '/portal',
      emailTemplate: 'welcome',
    });

    return verified;
  },

  async resendVerification(email: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true, fullName: true, emailVerifiedAt: true },
    });

    // Silent no-op on unknown or already-verified addresses — again, no
    // enumeration signal.
    if (!user || user.emailVerifiedAt) return;

    const token = generateToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        verificationToken: token,
        verificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600_000),
      },
    });

    await this.sendVerificationEmail(user.email, user.fullName, token);
  },

  /** Always resolves, whether or not the address exists. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true, fullName: true },
    });

    if (!user) {
      logger.info({ email }, 'Password reset requested for unknown address');
      return;
    }

    const token = generateToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: token,
        passwordResetExpiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      },
    });

    await mailService.send({
      to: user.email,
      subject: `Reset your ${env.APP_NAME} password`,
      template: 'reset-password',
      data: {
        fullName: user.fullName,
        resetUrl: `${env.APP_URL}/reset-password/${token}`,
        expiresInMinutes: RESET_TTL_MINUTES,
      },
    });
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { passwordResetToken: token },
      select: { id: true, passwordResetExpiresAt: true },
    });

    if (!user) throw new ValidationError('That reset link is not valid.');
    if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      throw new ValidationError('That reset link has expired. Please request a new one.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        failedLoginCount: 0,
        failedLoginAt: null,
      },
    });

    logger.info({ userId: user.id }, 'Password reset completed');
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw new UnauthorizedError();

    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new ValidationError('Your current password is not correct.');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
  },
};
