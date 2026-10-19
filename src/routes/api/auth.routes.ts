import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authService } from '../../services/auth.service.js';
import { refreshTokenService } from '../../services/refreshToken.service.js';
import { signToken } from '../../utils/jwt.js';
import { requireJwt } from '../../middleware/apiAuth.js';
import { authRateLimiter, refreshRateLimiter } from '../../middleware/rateLimit.js';
import { env } from '../../config/env.js';
import { prisma } from '../../config/database.js';
import { UnauthorizedError } from '../../utils/errors.js';

export const authApiRouter = Router();

/**
 * POST /api/v1/auth/login — exchange credentials for a short-lived access
 * JWT plus a longer-lived refresh token (security audit follow-up: the old
 * single long-lived JWT is gone — see refreshToken.service.ts).
 */
authApiRouter.post(
  '/login',
  authRateLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as Record<string, unknown>;

    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(422).json({ error: 'email and password are required.' });
      return;
    }

    const user = await authService.login(email, password, { ip: req.ip });

    // Mobile has no second-factor step; refuse rather than bypass MFA.
    if (user.mfaEnabled) {
      res.status(403).json({
        error:
          'This account has two-factor authentication enabled, which the mobile app does not support. Please sign in on the web.',
      });
      return;
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedError('Please verify your email before signing in on the app.');
    }

    const accessToken = signToken({
      sub: user.id,
      email: user.email,
      name: user.fullName,
      role: user.role,
    });

    const refresh = await refreshTokenService.issue(user.id, {
      userAgent: req.get('user-agent') ?? null,
      ipAddress: req.ip ?? null,
    });

    res.json({
      accessToken,
      expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.fullName,
        role: user.role,
      },
    });
  }),
);

/**
 * POST /api/v1/auth/refresh — trades a refresh token for a new access token
 * and a new (rotated) refresh token. The presented token is single-use:
 * reusing one already rotated away revokes its whole chain — see
 * refreshTokenService.rotate().
 */
authApiRouter.post(
  '/refresh',
  refreshRateLimiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as Record<string, unknown>;

    if (typeof refreshToken !== 'string' || !refreshToken) {
      res.status(422).json({ error: 'refreshToken is required.' });
      return;
    }

    const rotated = await refreshTokenService.rotate(refreshToken, {
      userAgent: req.get('user-agent') ?? null,
      ipAddress: req.ip ?? null,
    });

    const user = await prisma.user.findUnique({
      where: { id: rotated.userId },
      select: { id: true, email: true, fullName: true, role: true, status: true },
    });

    // The refresh token outlived the account, or it was suspended since —
    // same checks requireJwt applies to an access token.
    if (!user || user.status === 'SUSPENDED' || user.status === 'ARCHIVED') {
      throw new UnauthorizedError('That account is not active.');
    }

    const accessToken = signToken({
      sub: user.id,
      email: user.email,
      name: user.fullName,
      role: user.role,
    });

    res.json({
      accessToken,
      expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
      refreshToken: rotated.token,
      refreshTokenExpiresAt: rotated.expiresAt.toISOString(),
    });
  }),
);

/**
 * POST /api/v1/auth/logout — revokes the refresh token chain so it (and any
 * access token already issued off it, once that expires) can't be used to
 * get another one. Deliberately doesn't require a still-valid access token:
 * a device signing out may well have one that already expired.
 */
authApiRouter.post(
  '/logout',
  refreshRateLimiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as Record<string, unknown>;

    if (typeof refreshToken === 'string' && refreshToken) {
      await refreshTokenService.revokeByToken(refreshToken);
    }

    res.status(204).end();
  }),
);

/** GET /api/v1/auth/me — return the profile for the authenticated token */
authApiRouter.get('/me', requireJwt, (req, res) => {
  const u = req.currentUser!;
  res.json({
    id: u.id,
    email: u.email,
    name: u.fullName,
    role: u.role,
    studentProfileId: u.studentProfile?.id ?? null,
  });
});
