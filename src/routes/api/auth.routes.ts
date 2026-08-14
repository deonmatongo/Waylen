import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authService } from '../../services/auth.service.js';
import { signToken } from '../../utils/jwt.js';
import { requireJwt } from '../../middleware/apiAuth.js';
import { UnauthorizedError } from '../../utils/errors.js';

export const authApiRouter = Router();

/** POST /api/v1/auth/login — exchange credentials for a JWT */
authApiRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as Record<string, unknown>;

    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(422).json({ error: 'email and password are required.' });
      return;
    }

    const user = await authService.login(email, password);

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedError('Please verify your email before signing in on the app.');
    }

    const token = signToken({
      sub: user.id,
      email: user.email,
      name: user.fullName,
      role: user.role,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.fullName,
        role: user.role,
      },
    });
  }),
);

/** GET /api/v1/auth/me — return the profile for the authenticated token */
authApiRouter.get(
  '/me',
  requireJwt,
  asyncHandler(async (req, res) => {
    const u = req.currentUser!;
    res.json({
      id: u.id,
      email: u.email,
      name: u.fullName,
      role: u.role,
      studentProfileId: u.studentProfile?.id ?? null,
    });
  }),
);
