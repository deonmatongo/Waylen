import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface JwtPayload {
  sub: string;       // userId
  email: string;
  name: string;
  role: string;
  spid?: string;     // studentProfileId (students only)
  /** Seconds since epoch — set automatically by jsonwebtoken on sign(). */
  iat?: number;
}

/**
 * Access tokens are now short-lived (see refreshToken.service.ts for the
 * refresh side of this): ACCESS_TOKEN_TTL_MINUTES, not the old JWT_TTL_HOURS,
 * drives expiry so a leaked token is only usable briefly on its own.
 */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m`,
    audience: 'waylen-mobile',
    issuer: 'waylen-api',
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET, {
    audience: 'waylen-mobile',
    issuer: 'waylen-api',
  }) as JwtPayload;
}
