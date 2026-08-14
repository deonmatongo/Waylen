import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface JwtPayload {
  sub: string;       // userId
  email: string;
  name: string;
  role: string;
  spid?: string;     // studentProfileId (students only)
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: `${env.JWT_TTL_HOURS}h`,
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
