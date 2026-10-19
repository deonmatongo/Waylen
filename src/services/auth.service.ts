/**
 * Registration, sign-in, verification and password reset (PRD §5.1).
 */
import type { UserRole } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { hashPassword, verifyPassword, generateToken, sha256 } from '../utils/crypto.js';
import { studentReference } from '../utils/reference.js';
import { ConflictError, UnauthorizedError, ValidationError } from '../utils/errors.js';
import { mailService } from './mail.service.js';
import { notificationService } from './notification.service.js';
import { sessionService } from './session.service.js';
import { refreshTokenService } from './refreshToken.service.js';
import { referralService } from './referral.service.js';
import { loginThrottle } from './loginThrottle.service.js';

const VERIFICATION_TTL_HOURS = 48;
const RESET_TTL_MINUTES = 60;
/** Staff have longer to act on an invite than a "forgot password" link. */
const INVITE_TTL_HOURS = 24 * 7;
/** Consecutive failures before the account is temporarily locked. */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

/**
 * Verification and reset tokens are stored only as a SHA-256 hex digest (in
 * the existing verificationToken / passwordResetToken columns); the raw token
 * exists only in the emailed link, so a DB leak does not yield usable links.
 * A fast hash is right here: the tokens are 256 bits of randomness, so there
 * is nothing to brute-force (same reasoning as refreshToken.service.ts).
 */
export function hashToken(token: string): string {
  return sha256(Buffer.from(token, 'utf8'));
}

/** Generic message for every failed sign-in, whatever the reason. */
const INVALID_CREDENTIALS = 'That email or password is not correct.';

/** Verified against when the email is unknown/blocked, so response time doesn't reveal it. */
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(generateToken());
  return dummyHash;
}

export interface LockState {
  /** Sign-in must be refused right now. */
  locked: boolean;
  /** A previous lockout has run its course, so the counter starts over. */
  expired: boolean;
}

/**
 * Pure lockout decision. Once the window has elapsed the failure counter no
 * longer counts — otherwise a single further typo would instantly relock.
 */
export function getLockState(
  user: { failedLoginCount: number; failedLoginAt: Date | null },
  now = Date.now(),
): LockState {
  if (user.failedLoginCount < MAX_FAILED_LOGINS || !user.failedLoginAt) {
    return { locked: false, expired: false };
  }
  const withinWindow = now - user.failedLoginAt.getTime() < LOCKOUT_MINUTES * 60_000;
  return { locked: withinWindow, expired: !withinWindow };
}

/** A staff invite is pending until the person has signed in for the first time. */
export function isPendingInvite(user: { status: string; lastLoginAt: Date | null }): boolean {
  return user.status === 'ACTIVE' && user.lastLoginAt === null;
}

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  countryOfOriginIso?: string;
  preferredStudyLevel?: string;
  preferredCourses?: string[];
  preferredDestinationSlugs?: string[];
  /** Referrer's student reference from the signup link; ignored if unknown. */
  referralRef?: string;
}

export const authService = {
  /**
   * Creates a student account and its profile in one transaction, then emails
   * a verification link. Portal access stays closed until it is used.
   *
   * If the address is already registered nothing is created and the caller
   * gets `{ created: false }` — the controller responds exactly as for a new
   * signup (no enumeration), and the existing owner is emailed a notice.
   */
  async register(input: RegisterInput): Promise<{ created: boolean }> {
    const email = input.email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, fullName: true },
    });
    if (existing) {
      // Same argon2 cost as the create path, so timing doesn't give it away.
      await hashPassword(input.password);
      await this.sendExistingAccountNotice(email, existing.fullName);
      logger.info({ userId: existing.id }, 'Registration attempted for an existing account');
      return { created: false };
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

    // Unknown / self references resolve to null and are dropped silently.
    const referredByStudentId = await referralService.resolveReferrer(input.referralRef, email);

    const user = await prisma.user.create({
      data: {
        email,
        fullName: input.fullName.trim(),
        passwordHash,
        role: 'STUDENT',
        status: 'PENDING_VERIFICATION',
        verificationToken: hashToken(token),
        verificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600_000),
        studentProfile: {
          create: {
            reference: studentReference(),
            referredByStudentId,
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
    return { created: true };
  },

  /** Tells the owner of an existing account that someone tried to sign up with their address. */
  async sendExistingAccountNotice(email: string, fullName: string): Promise<void> {
    try {
      await mailService.send({
        to: email,
        subject: `Someone tried to create a ${env.APP_NAME} account with your email`,
        template: 'generic',
        data: {
          title: 'You already have an account',
          fullName,
          body:
            'Someone tried to register a new account with this email address, but you already have one. ' +
            'If that was you, you can sign in or reset your password below. If not, you can ignore this email — nothing has changed.',
          actionUrl: '/forgot-password',
          actionLabel: 'Reset my password',
        },
      });
    } catch (err) {
      logger.error({ err, email }, 'Existing-account notice failed to send');
    }
  },

  /**
   * A failed send must never undo the account creation (or token refresh)
   * that already happened — the token is still valid and stored, so
   * resendVerification() can retry once mail delivery is working again.
   */
  async sendVerificationEmail(email: string, fullName: string, token: string): Promise<void> {
    try {
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
    } catch (err) {
      logger.error({ err, email }, 'Verification email failed to send');
    }
  },

  /**
   * Authenticates a sign-in attempt.
   *
   * Every failure — unknown email, wrong password, locked, suspended or
   * archived — returns the same generic message after the same argon2 work,
   * so neither the response nor its timing can be used to enumerate accounts
   * or confirm one exists. The real reason is logged server-side.
   */
  async login(email: string, password: string, ctx: { ip?: string | null } = {}) {
    // IP-aware throttle first: an over-budget IP gets the generic failure
    // without touching the account, so it cannot drive account lockouts.
    const ip = ctx.ip || null;
    if (ip && (await loginThrottle.attempt(ip, email))) {
      logger.warn({ ip }, 'Sign-in throttled');
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }

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
        mfaEnabled: true,
        failedLoginCount: true,
        failedLoginAt: true,
      },
    });

    if (!user) {
      await verifyPassword(await getDummyHash(), password);
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }

    const lock = getLockState(user);
    const blocked = user.status === 'SUSPENDED' || user.status === 'ARCHIVED';

    // Verify even when the account is locked or blocked so every failure
    // costs the same; the result is ignored in those cases.
    const valid = await verifyPassword(user.passwordHash, password);

    if (blocked || lock.locked) {
      logger.warn(
        { userId: user.id, reason: blocked ? `status:${user.status}` : 'locked' },
        'Sign-in refused',
      );
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }

    if (!valid) {
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          // An expired lockout restarts the count rather than relocking at once.
          failedLoginCount: lock.expired ? 1 : { increment: 1 },
          failedLoginAt: new Date(),
        },
        select: { failedLoginCount: true },
      });
      // Reaching the threshold exactly happens once per lockout window
      // (further attempts are refused above), so this mails once.
      if (updated?.failedLoginCount === MAX_FAILED_LOGINS) {
        await this.sendLockoutNotice(user.email, user.fullName);
      }
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, failedLoginAt: null },
    });
    if (ip) await loginThrottle.succeeded(ip, email);

    return user;
  },

  /** Tells the owner their account was temporarily locked after repeated failures. */
  async sendLockoutNotice(email: string, fullName: string): Promise<void> {
    try {
      await mailService.send({
        to: email,
        subject: `Your ${env.APP_NAME} account is temporarily locked`,
        template: 'generic',
        data: {
          title: 'Your account is temporarily locked',
          fullName,
          body:
            `There were several unsuccessful attempts to sign in to your account, so we have paused sign-in for ${LOCKOUT_MINUTES} minutes. ` +
            "If that was you, wait and try again, or reset your password. If it wasn't, we recommend resetting your password now.",
          actionUrl: '/forgot-password',
          actionLabel: 'Reset my password',
        },
      });
    } catch (err) {
      logger.error({ err, email }, 'Lockout notice failed to send');
    }
  },

  /** Consumes a verification token. Tokens are single-use and time-limited. */
  async verifyEmail(token: string) {
    const user = await prisma.user.findUnique({
      where: { verificationToken: hashToken(token) },
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
        verificationToken: hashToken(token),
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
        passwordResetToken: hashToken(token),
        passwordResetExpiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      },
    });

    // This method's contract (and the controller's) is to always resolve
    // the same way whether or not the address exists — a delivery failure
    // must not turn into a 500 that tells an attacker anything, or leave a
    // real user staring at an error instead of the "check your email" page.
    try {
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
    } catch (err) {
      logger.error({ err, email: user.email }, 'Password reset email failed to send');
    }
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { passwordResetToken: hashToken(token) },
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
        // A reset proves control of the inbox just as verification does —
        // don't leave a still-valid verification link lying around.
        verificationToken: null,
        verificationExpiresAt: null,
        failedLoginCount: 0,
        failedLoginAt: null,
        // Invalidates every session/JWT issued before this moment — see
        // passwordChangedAt on the model and the checks in middleware/auth.ts
        // and middleware/apiAuth.ts.
        passwordChangedAt: new Date(),
      },
    });

    // A reset usually means the old credential may be compromised: end every
    // browser session and mobile refresh chain, not just stop issuing new ones.
    await Promise.all([
      sessionService.revokeAllForUser(user.id),
      refreshTokenService.revokeAllForUser(user.id),
    ]);

    logger.info({ userId: user.id }, 'Password reset completed');
  },

  /**
   * Creates a staff account and emails an invite link so they choose their
   * own password — an admin never sets one on their behalf (PRD §5.4).
   */
  async inviteStaff(input: { email: string; fullName: string; role: UserRole; jobTitle?: string }) {
    const email = input.email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictError('An account already exists for that email address.');

    const token = generateToken();
    // Nobody knows this password — the account is unusable until the invite
    // link is used to set a real one via the same passwordResetToken flow.
    const passwordHash = await hashPassword(generateToken());

    const user = await prisma.user.create({
      data: {
        email,
        fullName: input.fullName.trim(),
        passwordHash,
        role: input.role,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        passwordResetToken: hashToken(token),
        passwordResetExpiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600_000),
        staffProfile: { create: { jobTitle: input.jobTitle ?? null, regions: '[]' } },
      },
    });

    await this.sendStaffInviteEmail(user.email, user.fullName, token);

    logger.info({ userId: user.id, role: user.role }, 'Staff member invited');
    return user;
  },

  /** The account already exists when this runs, so a failed send is logged, not thrown. */
  async sendStaffInviteEmail(email: string, fullName: string, token: string): Promise<void> {
    try {
      await mailService.send({
        to: email,
        subject: `You're invited to join ${env.APP_NAME}`,
        template: 'invite-staff',
        data: {
          fullName,
          inviteUrl: `${env.APP_URL}/reset-password/${token}`,
          expiresInDays: Math.round(INVITE_TTL_HOURS / 24),
        },
      });
    } catch (err) {
      logger.error({ err, email }, 'Staff invite email failed to send');
    }
  },

  /**
   * Re-issues the invite link for a staff member who has never signed in
   * (the previous link may have expired or been lost). The old token is
   * replaced, so it stops working.
   */
  async resendStaffInvite(userId: string, staffRoles: readonly UserRole[]): Promise<{ email: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, role: true, status: true, lastLoginAt: true },
    });
    if (!user || !staffRoles.includes(user.role)) {
      throw new ValidationError('Only staff accounts can be sent an invite.');
    }
    if (!isPendingInvite(user)) {
      throw new ValidationError('That person has already signed in — there is no pending invite to resend.');
    }

    const token = generateToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashToken(token),
        passwordResetExpiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600_000),
      },
    });

    await this.sendStaffInviteEmail(user.email, user.fullName, token);
    logger.info({ userId: user.id }, 'Staff invite resent');
    return { email: user.email };
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
      data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
    });

    // Sign the user out everywhere (passwordChangedAt already invalidates the
    // current session on its next request).
    await Promise.all([
      sessionService.revokeAllForUser(userId),
      refreshTokenService.revokeAllForUser(userId),
    ]);
  },

  /**
   * Reverses a suspension (and clears any login lockout). An account that
   * never verified its email goes back to PENDING_VERIFICATION, not ACTIVE.
   */
  async unsuspend(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, emailVerifiedAt: true },
    });
    if (!user) throw new ValidationError('That user could not be found.');
    if (user.status !== 'SUSPENDED') return;

    await prisma.user.update({
      where: { id: userId },
      data: {
        status: user.emailVerifiedAt ? 'ACTIVE' : 'PENDING_VERIFICATION',
        failedLoginCount: 0,
        failedLoginAt: null,
      },
    });
    logger.info({ userId }, 'User unsuspended');
  },
};
