import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, registerSchema, type AuthResponse, type UserDto } from '@pulsewatch/shared';
import { prisma } from '../db.js';
import {
  hashPassword,
  signToken,
  TIMING_EQUALIZER_HASH,
  verifyPassword,
} from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';

export const authRouter = Router();

/** Slows down credential stuffing without inconveniencing a real person. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
});

/**
 * Registration reveals whether an email is taken (it has to, to be usable),
 * and creates rows. Both make unthrottled signup worth limiting.
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-ups, try again later' } },
});

function toUserDto(u: {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
}): UserDto {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as UserDto['role'],
    createdAt: u.createdAt.toISOString(),
  };
}

authRouter.post('/auth/register', registerLimiter, validateBody(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(409, 'EMAIL_TAKEN', 'An account with that email already exists');
    }

    // First account bootstraps the system as admin; everyone after is an engineer.
    const isFirstUser = (await prisma.user.count()) === 0;

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        role: isFirstUser ? 'admin' : 'engineer',
      },
    });

    const body: AuthResponse = {
      token: signToken({ sub: user.id, email: user.email, role: user.role as UserDto['role'] }),
      user: toUserDto(user),
    };
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/login', loginLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    // Always run bcrypt, against a stand-in hash when there is no user, so an
    // unknown email is neither a different message nor a faster response.
    const ok = await verifyPassword(password, user?.passwordHash ?? TIMING_EQUALIZER_HASH);
    if (!user || !ok) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }

    const body: AuthResponse = {
      token: signToken({ sub: user.id, email: user.email, role: user.role as UserDto['role'] }),
      user: toUserDto(user),
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

authRouter.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Account no longer exists');
    res.json(toUserDto(user));
  } catch (err) {
    next(err);
  }
});
