/**
 * Staff two-factor: the /login/mfa challenge and /account/security enrolment.
 */
import type { Request, Response } from 'express';
import { parse as parseCookie } from 'cookie';
import QRCode from 'qrcode';
import { prisma } from '../../config/database.js';
import { mfaService } from '../../services/mfa.service.js';
import { auditService } from '../../services/audit.service.js';
import { verifyPassword } from '../../utils/crypto.js';
import { MFA_PENDING_COOKIE, mfaPendingCookieOptions, verifyPending } from '../../utils/mfaPending.js';
import { completeLogin } from './login.controller.js';

function pendingFrom(req: Request) {
  return verifyPending(parseCookie(req.headers.cookie ?? '')[MFA_PENDING_COOKIE]);
}

function clearPending(res: Response): void {
  const { maxAge: _maxAge, ...opts } = mfaPendingCookieOptions;
  res.clearCookie(MFA_PENDING_COOKIE, opts);
}

function renderChallenge(res: Response, error?: string, status = 200): void {
  res.status(status).render('auth/login-mfa', {
    title: 'Two-factor verification',
    layout: 'layouts/auth',
    error,
  });
}

export async function showChallenge(req: Request, res: Response): Promise<void> {
  if (!pendingFrom(req)) {
    res.redirect('/login');
    return;
  }
  renderChallenge(res);
}

export async function submitChallenge(req: Request, res: Response): Promise<void> {
  const pending = pendingFrom(req);
  if (!pending) {
    clearPending(res);
    req.flash('error', 'Your sign-in session expired. Please sign in again.');
    res.redirect('/login');
    return;
  }

  const rawCode = (req.body as Record<string, unknown> | undefined)?.code;
  const code = typeof rawCode === 'string' ? rawCode.slice(0, 32) : '';
  const result = await mfaService.verifyChallenge(pending.userId, pending.nonce, code);

  if (!result.ok) {
    await auditService.record({
      actorId: pending.userId,
      action: 'LOGIN_FAILED',
      entity: 'User',
      entityId: pending.userId,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      changes: { stage: 'mfa', reason: result.reason },
    });
    if (result.reason === 'invalid') {
      renderChallenge(res, 'That code is not correct.', 401);
      return;
    }
    clearPending(res);
    req.flash(
      'error',
      result.reason === 'locked'
        ? 'Too many incorrect codes. Please sign in again.'
        : 'Your sign-in session expired. Please sign in again.',
    );
    res.redirect('/login');
    return;
  }

  clearPending(res);
  const user = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: { id: true, role: true, fullName: true, emailVerifiedAt: true, status: true },
  });
  if (!user || user.status === 'SUSPENDED' || user.status === 'ARCHIVED') {
    res.redirect('/login');
    return;
  }
  if (result.kind === 'recovery') {
    req.flash('warning', 'You signed in with a recovery code. Consider regenerating your two-factor setup.');
  }
  await completeLogin(req, res, user, true);
}

// ── /account/security ──────────────────────────────────────────────────────

interface View {
  enabled: boolean;
  setup?: { secret: string; uri: string; qrSvg?: string } | null;
  recoveryCodes?: string[] | null;
  errors?: Record<string, string>;
}

/**
 * Inline SVG of the otpauth URI. Rendered server-side so the secret never
 * leaves the app and no CSP change is needed; failure just hides the QR.
 */
async function withQr(setup: { secret: string; uri: string } | null | undefined): Promise<View['setup']> {
  if (!setup) return setup;
  try {
    const qrSvg = await QRCode.toString(setup.uri, { type: 'svg', margin: 1, width: 220 });
    return { ...setup, qrSvg };
  } catch {
    return setup;
  }
}

function renderSecurity(res: Response, view: View, status = 200): void {
  res.status(status).render('auth/security', {
    title: 'Account security',
    layout: 'layouts/admin',
    recoveryCodes: null,
    setup: null,
    errors: {},
    ...view,
  });
}

export async function showSecurity(req: Request, res: Response): Promise<void> {
  const state = await mfaService.getState(req.currentUser!.id);
  if (state?.mfaEnabled) {
    renderSecurity(res, { enabled: true });
    return;
  }
  const email = req.currentUser!.email;
  const setup =
    mfaService.pendingSecret(state?.mfaSecret ?? null, email) ??
    (await mfaService.beginEnrolment(req.currentUser!.id, email));
  renderSecurity(res, { enabled: false, setup: await withQr(setup) });
}

export async function submitSecurity(req: Request, res: Response): Promise<void> {
  const user = req.currentUser!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const code = typeof body.code === 'string' ? body.code.slice(0, 32) : '';
  const state = await mfaService.getState(user.id);

  if (body.action === 'disable') {
    if (!state?.mfaEnabled) {
      res.redirect('/account/security');
      return;
    }
    const password = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const passwordOk = await verifyPassword(state.passwordHash, password);
    const codeOk = passwordOk && (await mfaService.disable(user.id, code));
    if (!passwordOk || !codeOk) {
      renderSecurity(
        res,
        {
          enabled: true,
          errors: { disable: !passwordOk ? 'Your password is not correct.' : 'That code is not correct.' },
        },
        422,
      );
      return;
    }
    await auditService.record({
      actorId: user.id,
      action: 'UPDATE',
      entity: 'User',
      entityId: user.id,
      changes: { mfaEnabled: { from: true, to: false } },
      ipAddress: req.ip ?? null,
    });
    req.flash('success', 'Two-factor authentication has been disabled.');
    res.redirect('/account/security');
    return;
  }

  // Default: confirm enrolment.
  if (state?.mfaEnabled) {
    res.redirect('/account/security');
    return;
  }
  const codes = await mfaService.confirmEnrolment(user.id, code);
  if (!codes) {
    renderSecurity(
      res,
      {
        enabled: false,
        setup: await withQr(mfaService.pendingSecret(state?.mfaSecret ?? null, user.email)),
        errors: { code: 'That code is not correct. Check your authenticator app and try again.' },
      },
      422,
    );
    return;
  }
  await auditService.record({
    actorId: user.id,
    action: 'UPDATE',
    entity: 'User',
    entityId: user.id,
    changes: { mfaEnabled: { from: false, to: true } },
    ipAddress: req.ip ?? null,
  });
  renderSecurity(res, { enabled: true, recoveryCodes: codes });
}
