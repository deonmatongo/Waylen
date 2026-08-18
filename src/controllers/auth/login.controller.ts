/**
 * Sign in and sign out (PRD §5.1).
 */
import type { Request, Response } from 'express';
import { authService } from '../../services/auth.service.js';
import { loginSchema } from '../../validators/auth.validator.js';
import { auditService } from '../../services/audit.service.js';
import { STAFF_ROLES } from '../../config/constants.js';

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
    const user = await authService.login(parsed.data.email, parsed.data.password);

    // Session fixation isn't a risk here the way it is with a server-side
    // store: there is no session id an attacker could pre-seed and have the
    // victim adopt — the cookie itself, signed with SESSION_SECRET, is the
    // only thing that carries the login, and setting these fields overwrites
    // whatever an attacker could have staged in it.
    req.session!.userId = user.id;
    req.session!.role = user.role;
    req.session!.fullName = user.fullName;
    req.session!.emailVerified = Boolean(user.emailVerifiedAt);

    await auditService.record({
      actorId: user.id,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
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

export async function logout(req: Request, res: Response): Promise<void> {
  const userId = req.currentUser?.id;

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
