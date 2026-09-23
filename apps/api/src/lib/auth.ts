import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { UserRole } from '@pulsewatch/shared';
import { env } from '../env.js';

/** Cost factor 10 is the usual balance of safety and login latency. */
const SALT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A real bcrypt hash of nothing in particular, computed once at startup.
 * Login compares against it when the email is unknown, so "no such user" costs
 * the same ~50ms of bcrypt as "wrong password". Without it an unknown email
 * answers measurably faster, and response time alone reveals which emails have
 * accounts -- even though the error message is identical.
 */
export const TIMING_EQUALIZER_HASH = bcrypt.hashSync('pulsewatch-timing-equalizer', SALT_ROUNDS);

export interface TokenPayload {
  sub: number;
  email: string;
  role: UserRole;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Returns null rather than throwing, so callers decide what a bad token means. */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'string') return null;
    return {
      sub: Number(decoded.sub),
      email: String(decoded.email),
      role: decoded.role as UserRole,
    };
  } catch {
    return null;
  }
}
