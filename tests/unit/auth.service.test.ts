import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  country: { findUnique: vi.fn(), findMany: vi.fn() },
}));
const mailSend = vi.hoisted(() => vi.fn());
const revokeSessions = vi.hoisted(() => vi.fn());
const revokeRefresh = vi.hoisted(() => vi.fn());
const cryptoMock = vi.hoisted(() => ({ verifyPassword: vi.fn() }));

vi.mock('../../src/config/database.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/services/mail.service.js', () => ({ mailService: { send: mailSend } }));
vi.mock('../../src/services/notification.service.js', () => ({
  notificationService: { dispatch: vi.fn() },
}));
vi.mock('../../src/services/session.service.js', () => ({
  sessionService: { revokeAllForUser: revokeSessions },
}));
vi.mock('../../src/services/refreshToken.service.js', () => ({
  refreshTokenService: { revokeAllForUser: revokeRefresh },
}));
vi.mock('../../src/utils/crypto.js', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    hashPassword: vi.fn().mockResolvedValue('$argon2id$stub'),
    verifyPassword: cryptoMock.verifyPassword,
  };
});

const { authService, hashToken, getLockState } = await import('../../src/services/auth.service.js');

const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  cryptoMock.verifyPassword.mockResolvedValue(false);
  prismaMock.user.update.mockResolvedValue({});
  revokeSessions.mockResolvedValue(undefined);
  revokeRefresh.mockResolvedValue(undefined);
});

describe('hashToken', () => {
  it('is the SHA-256 hex digest, never the raw token', () => {
    expect(hashToken('abc')).toBe(sha('abc'));
    expect(hashToken('abc')).not.toBe('abc');
    expect(hashToken('abc')).toHaveLength(64);
  });
});

describe('getLockState', () => {
  it('is not locked below the threshold', () => {
    expect(getLockState({ failedLoginCount: 7, failedLoginAt: new Date() })).toEqual({
      locked: false,
      expired: false,
    });
  });
  it('is locked at the threshold inside the window', () => {
    expect(getLockState({ failedLoginCount: 8, failedLoginAt: minutesAgo(1) }).locked).toBe(true);
  });
  it('is expired (not locked) once the window has passed', () => {
    expect(getLockState({ failedLoginCount: 8, failedLoginAt: minutesAgo(16) })).toEqual({
      locked: false,
      expired: true,
    });
  });
});

describe('login', () => {
  const baseUser = {
    id: 'u1',
    email: 'a@b.co',
    fullName: 'A B',
    passwordHash: '$argon2id$real',
    role: 'STUDENT',
    status: 'ACTIVE',
    emailVerifiedAt: new Date(),
    failedLoginCount: 0,
    failedLoginAt: null,
  };
  const GENERIC = 'That email or password is not correct.';

  it('gives the generic message and still does argon2 work for an unknown email', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(authService.login('x@y.co', 'pw')).rejects.toThrow(GENERIC);
    expect(cryptoMock.verifyPassword).toHaveBeenCalledTimes(1);
  });

  it.each(['SUSPENDED', 'ARCHIVED'])('gives the generic message for a %s account', async (status) => {
    prismaMock.user.findUnique.mockResolvedValue({ ...baseUser, status });
    cryptoMock.verifyPassword.mockResolvedValue(true);
    await expect(authService.login(baseUser.email, 'pw')).rejects.toThrow(GENERIC);
    expect(cryptoMock.verifyPassword).toHaveBeenCalledTimes(1);
  });

  it('stays locked (generic message) even with the right password', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...baseUser,
      failedLoginCount: 8,
      failedLoginAt: minutesAgo(1),
    });
    cryptoMock.verifyPassword.mockResolvedValue(true);
    await expect(authService.login(baseUser.email, 'pw')).rejects.toThrow(GENERIC);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('restarts the failure count at 1 after an expired lockout instead of relocking', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...baseUser,
      failedLoginCount: 8,
      failedLoginAt: minutesAgo(30),
    });
    await expect(authService.login(baseUser.email, 'wrong')).rejects.toThrow(GENERIC);
    const data = prismaMock.user.update.mock.calls[0]![0].data;
    expect(data.failedLoginCount).toBe(1);
  });

  it('increments normally on a failure with no prior lockout', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...baseUser, failedLoginCount: 2, failedLoginAt: minutesAgo(1) });
    await expect(authService.login(baseUser.email, 'wrong')).rejects.toThrow(GENERIC);
    expect(prismaMock.user.update.mock.calls[0]![0].data.failedLoginCount).toEqual({ increment: 1 });
  });

  it('succeeds and clears the counter with the right password after an expired lockout', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...baseUser,
      failedLoginCount: 8,
      failedLoginAt: minutesAgo(30),
    });
    cryptoMock.verifyPassword.mockResolvedValue(true);
    const user = await authService.login(baseUser.email, 'pw');
    expect(user.id).toBe('u1');
    expect(prismaMock.user.update.mock.calls[0]![0].data).toMatchObject({ failedLoginCount: 0 });
  });
});

describe('register', () => {
  const input = { fullName: 'New One', email: ' New@Example.com ', password: 'Str0ngPassw0rd!' };

  it('does not create anything for an existing email, and notifies its owner', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', fullName: 'Existing Owner' });
    const result = await authService.register(input);
    expect(result).toEqual({ created: false });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(mailSend).toHaveBeenCalledTimes(1);
    expect(mailSend.mock.calls[0]![0]).toMatchObject({ to: 'new@example.com', template: 'generic' });
  });

  it('stores only the hash of the verification token and emails the raw one', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'u2',
      email: 'new@example.com',
      fullName: 'New One',
      studentProfile: { id: 'p', reference: 'R' },
    });
    const result = await authService.register(input);
    expect(result).toEqual({ created: true });

    const stored = prismaMock.user.create.mock.calls[0]![0].data.verificationToken as string;
    const url = mailSend.mock.calls[0]![0].data.verifyUrl as string;
    const raw = url.split('/verify-email/')[1]!;
    expect(stored).toBe(sha(raw));
    expect(stored).not.toBe(raw);
  });
});

describe('verification and reset tokens', () => {
  it('verifyEmail looks the token up by its hash', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(authService.verifyEmail('raw-token')).rejects.toThrow(/not valid/);
    expect(prismaMock.user.findUnique.mock.calls[0]![0].where).toEqual({
      verificationToken: sha('raw-token'),
    });
  });

  it('requestPasswordReset stores the hash and emails the raw token', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.co', fullName: 'A B' });
    await authService.requestPasswordReset('a@b.co');
    const stored = prismaMock.user.update.mock.calls[0]![0].data.passwordResetToken as string;
    const raw = (mailSend.mock.calls[0]![0].data.resetUrl as string).split('/reset-password/')[1]!;
    expect(stored).toBe(sha(raw));
  });

  it('resetPassword looks up by hash, clears both tokens, and revokes sessions + refresh tokens', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      passwordResetExpiresAt: new Date(Date.now() + 60_000),
    });
    await authService.resetPassword('raw-reset', 'NewStr0ngPass!');
    expect(prismaMock.user.findUnique.mock.calls[0]![0].where).toEqual({
      passwordResetToken: sha('raw-reset'),
    });
    expect(prismaMock.user.update.mock.calls[0]![0].data).toMatchObject({
      passwordResetToken: null,
      verificationToken: null,
    });
    expect(revokeSessions).toHaveBeenCalledWith('u1');
    expect(revokeRefresh).toHaveBeenCalledWith('u1');
  });
});

describe('changePassword', () => {
  it('revokes every session and refresh chain', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordHash: '$argon2id$real' });
    cryptoMock.verifyPassword.mockResolvedValue(true);
    await authService.changePassword('u1', 'old', 'NewStr0ngPass!');
    expect(prismaMock.user.update.mock.calls[0]![0].data.passwordChangedAt).toBeInstanceOf(Date);
    expect(revokeSessions).toHaveBeenCalledWith('u1');
    expect(revokeRefresh).toHaveBeenCalledWith('u1');
  });

  it('revokes nothing when the current password is wrong', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ passwordHash: '$argon2id$real' });
    await expect(authService.changePassword('u1', 'bad', 'NewStr0ngPass!')).rejects.toThrow();
    expect(revokeSessions).not.toHaveBeenCalled();
  });
});

describe('unsuspend', () => {
  it('reactivates a verified suspended user and clears the lockout', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', status: 'SUSPENDED', emailVerifiedAt: new Date() });
    await authService.unsuspend('u1');
    expect(prismaMock.user.update.mock.calls[0]![0].data).toMatchObject({
      status: 'ACTIVE',
      failedLoginCount: 0,
    });
  });
  it('is a no-op for a user who is not suspended', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', status: 'ACTIVE', emailVerifiedAt: new Date() });
    await authService.unsuspend('u1');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
