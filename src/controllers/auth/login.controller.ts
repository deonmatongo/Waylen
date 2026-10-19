/**
 * Sign in and sign out (PRD §5.1).
 */
import type { Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { authService } from '../../services/auth.service.js';
import { loginSchema } from '../../validators/auth.validator.js';
import { auditService } from '../../services/audit.service.js';
import { sessionService } from '../../services/session.service.js';
import { STAFF_ROLES } from '../../config/constants.js';
import { mfaService } from '../../services/mfa.service.js';
import {
  MFA_PENDING_COOKIE,
  mfaPendingCookieOptions,
  signPending,
} from '../../utils/mfaPending.js';

export async function show(_req: Request, res: Response): Promise<void> {
  res.render('auth/login', {
    title: 'Sign in',
    layout: 'layouts/auth',
    values: {},
    errors: {},
  });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  // Kept so a validation failure re-renders with the address already typed.
  const submittedEmail = (req.body as Record<string, unknown> | undefined)?.email;

  if (!parsed.success) {
    res.status(422).render('auth/login', {
      title: 'Sign in',
      layout: 'layouts/auth',
      values: { email: typeof submittedEmail === 'string' ? submittedEmail : '' },
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const user = await authService.login(parsed.data.email, parsed.data.password, { ip: req.ip });

    if (user.mfaEnabled) {
      const challenge = await mfaService.startChallenge(user.id);
      if (challenge) {
        res.cookie(
          MFA_PENDING_COOKIE,
          signPending({ userId: user.id, expiresAt: challenge.expiresAt, nonce: challenge.nonce }),
          mfaPendingCookieOptions,
        );
        res.redirect('/login/mfa');
        return;
      }
      // Unreadable MFA state must fail closed, never fall through to a session.
      throw new Error('Two-factor sign-in is unavailable for this account. Contact an administrator.');
    }

    await completeLogin(req, res, user, false);
  } catch (err) {
    await auditService.record({
      action: 'LOGIN_FAILED',
      entity: 'User',
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      changes: { email: parsed.data.email },
    });

    res.status(401).render('auth/login', {
      title: 'Sign in',
      layout: 'layouts/auth',
      values: { email: parsed.data.email },
      errors: { form: [(err as Error).message] },
    });
  }
}

export interface LoginUser {
  id: string;
  role: UserRole;
  fullName: string;
  emailVerifiedAt: Date | null;
}

/** Establishes the session once every factor has passed, and redirects. */
export async function completeLogin(
  req: Request,
  res: Response,
  user: LoginUser,
  mfa: boolean,
): Promise<void> {
  // Session fixation isn't a risk here the way it is with a server-side
  // store: there is no session id an attacker could pre-seed and have the
  // victim adopt — the cookie itself, signed with SESSION_SECRET, is the
  // only thing that carries the login, and setting these fields overwrites
  // whatever an attacker could have staged in it. The server-side Session
  // row created below is a fresh id either way, so this holds for it too.
  const session = await sessionService.create({
    userId: user.id,
    userAgent: req.get('user-agent') ?? null,
    ipAddress: req.ip ?? null,
  });

  req.session!.userId = user.id;
  req.session!.role = user.role;
  req.session!.fullName = user.fullName;
  req.session!.emailVerified = Boolean(user.emailVerifiedAt);
  req.session!.issuedAt = Date.now();
  req.session!.sessionId = session.id;

  await auditService.record({
    actorId: user.id,
    action: 'LOGIN',
    entity: 'User',
    entityId: user.id,
    changes: { mfa },
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });

  // Unverified accounts get no further than the pending page (PRD §5.1).
  if (!user.emailVerifiedAt) {
    res.redirect('/verify-email/pending');
    return;
  }

  const returnTo = req.session!.returnTo;
  delete req.session!.returnTo;

  const home = STAFF_ROLES.includes(user.role) ? '/admin' : '/portal';
  res.redirect(returnTo ?? home);
}

export async function logout(req: Request, res: Response): Promise<void> {
  const userId = req.currentUser?.id;
  const sessionId = req.session?.sessionId;

  // Revoke the server-side record for *this* session before clearing the
  // cookie — this is what makes a captured pre-logout cookie stop working
  // immediately, rather than only once SESSION_TTL_HOURS naturally expires.
  if (sessionId) {
    await sessionService.revoke(sessionId);
  }

  req.session = null;

  if (userId) {
    await auditService.record({
      actorId: userId,
      action: 'LOGOUT',
      entity: 'User',
      entityId: userId,
      ipAddress: req.ip ?? null,
    });
  }

  res.redirect('/');
}
