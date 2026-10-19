import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  country: { findUnique: vi.fn(), findMany: vi.fn() },
  studentProfile: { findUnique: vi.fn(), count: vi.fn() },
}));
const mailSend = vi.hoisted(() => vi.fn());
const cryptoMock = vi.hoisted(() => ({ verifyPassword: vi.fn() }));

vi.mock('../../src/config/database.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/services/mail.service.js', () => ({ mailService: { send: mailSend } }));
vi.mock('../../src/services/audit.service.js', () => ({ auditService: { record: vi.fn() } }));
vi.mock('../../src/services/notification.service.js', () => ({
  notificationService: { dispatch: vi.fn() },
}));
vi.mock('../../src/services/session.service.js', () => ({ sessionService: {} }));
vi.mock('../../src/services/refreshToken.service.js', () => ({ refreshTokenService: {} }));
vi.mock('../../src/utils/crypto.js', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    hashPassword: vi.fn().mockResolvedValue('$argon2id$stub'),
    verifyPassword: cryptoMock.verifyPassword,
  };
});

const { authService, isPendingInvite, hashToken } = await import('../../src/services/auth.service.js');
const { setLoginThrottleCounters, PAIR_LIMIT, IP_LIMIT } = await import(
  '../../src/services/loginThrottle.service.js'
);
const { normaliseReferralRef } = await import('../../src/services/referral.service.js');
const { registerSchema } = await import('../../src/validators/auth.validator.js');

/** In-memory CounterStore: no window, just counts. */
function fakeCounter() {
  const m = new Map<string, number>();
  return {
    m,
    hit: (k: string) => {
      m.set(k, (m.get(k) ?? 0) + 1);
      return Promise.resolve(m.get(k)!);
    },
    unhit: (k: string) => {
      m.set(k, (m.get(k) ?? 1) - 1);
      return Promise.resolve();
    },
    reset: (k: string) => {
      m.delete(k);
      return Promise.resolve();
    },
  };
}

const GENERIC = 'That email or password is not correct.';
const user = {
  id: 'u1',
  email: 'a@b.co',
  fullName: 'A B',
  passwordHash: 'h',
  role: 'STUDENT',
  status: 'ACTIVE',
  emailVerifiedAt: new Date(),
  mfaEnabled: false,
  failedLoginCount: 0,
  failedLoginAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  setLoginThrottleCounters({ pair: fakeCounter(), ip: fakeCounter() });
  cryptoMock.verifyPassword.mockResolvedValue(false);
  prismaMock.user.findUnique.mockResolvedValue(user);
  prismaMock.user.update.mockResolvedValue({ failedLoginCount: 1 });
  mailSend.mockResolvedValue(undefined);
});

describe('login throttle', () => {
  it('refuses an over-budget IP+email pair without touching the account', async () => {
    for (let i = 0; i < PAIR_LIMIT; i++) {
      await expect(authService.login(user.email, 'x', { ip: '1.1.1.1' })).rejects.toThrow(GENERIC);
    }
    prismaMock.user.update.mockClear();
    await expect(authService.login(user.email, 'x', { ip: '1.1.1.1' })).rejects.toThrow(GENERIC);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('stops one IP spraying many emails past the per-IP budget', async () => {
    for (let i = 0; i < IP_LIMIT; i++) {
      await expect(authService.login(`u${i}@b.co`, 'x', { ip: '2.2.2.2' })).rejects.toThrow(GENERIC);
    }
    prismaMock.user.findUnique.mockClear();
    await expect(authService.login('new@b.co', 'x', { ip: '2.2.2.2' })).rejects.toThrow(GENERIC);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not throttle a different IP for the same email', async () => {
    for (let i = 0; i < PAIR_LIMIT + 1; i++) {
      await authService.login(user.email, 'x', { ip: '1.1.1.1' }).catch(() => undefined);
    }
    cryptoMock.verifyPassword.mockResolvedValue(true);
    await expect(authService.login(user.email, 'ok', { ip: '9.9.9.9' })).resolves.toMatchObject({ id: 'u1' });
  });

  it('a success clears the pair counter', async () => {
    for (let i = 0; i < PAIR_LIMIT - 1; i++) {
      await authService.login(user.email, 'x', { ip: '3.3.3.3' }).catch(() => undefined);
    }
    cryptoMock.verifyPassword.mockResolvedValue(true);
    await authService.login(user.email, 'ok', { ip: '3.3.3.3' });
    cryptoMock.verifyPassword.mockResolvedValue(false);
    for (let i = 0; i < PAIR_LIMIT; i++) {
      await expect(authService.login(user.email, 'x', { ip: '3.3.3.3' })).rejects.toThrow(GENERIC);
    }
    expect(prismaMock.user.update).toHaveBeenCalledTimes(PAIR_LIMIT - 1 + 1 + PAIR_LIMIT);
  });

  it('fails open when the store errors', async () => {
    const broken = { hit: () => Promise.reject(new Error('down')), unhit: vi.fn(), reset: vi.fn() };
    setLoginThrottleCounters({ pair: broken, ip: broken });
    await expect(authService.login(user.email, 'x', { ip: '4.4.4.4' })).rejects.toThrow(GENERIC);
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it('skips throttling when no IP is known', async () => {
    for (let i = 0; i < PAIR_LIMIT + 3; i++) {
      await authService.login(user.email, 'x').catch(() => undefined);
    }
    expect(prismaMock.user.update).toHaveBeenCalledTimes(PAIR_LIMIT + 3);
  });
});

describe('lockout notice', () => {
  it('emails the owner once, when the threshold is reached', async () => {
    prismaMock.user.update.mockResolvedValue({ failedLoginCount: 8 });
    await expect(authService.login(user.email, 'x')).rejects.toThrow(GENERIC);
    expect(mailSend).toHaveBeenCalledTimes(1);
    expect(mailSend.mock.calls[0]![0]).toMatchObject({ to: user.email, template: 'generic' });
  });

  it('does not email below the threshold or when mail fails', async () => {
    prismaMock.user.update.mockResolvedValue({ failedLoginCount: 7 });
    await expect(authService.login(user.email, 'x')).rejects.toThrow(GENERIC);
    expect(mailSend).not.toHaveBeenCalled();

    prismaMock.user.update.mockResolvedValue({ failedLoginCount: 8 });
    mailSend.mockRejectedValue(new Error('smtp'));
    await expect(authService.login(user.email, 'x')).rejects.toThrow(GENERIC);
  });
});

describe('resendStaffInvite', () => {
  const staff = { id: 's1', email: 's@w.co', fullName: 'S', role: 'ADMIN', status: 'ACTIVE', lastLoginAt: null };
  const roles = ['ADMIN', 'SUPER_ADMIN'] as never[];

  it('isPendingInvite requires active and never signed in', () => {
    expect(isPendingInvite({ status: 'ACTIVE', lastLoginAt: null })).toBe(true);
    expect(isPendingInvite({ status: 'ACTIVE', lastLoginAt: new Date() })).toBe(false);
    expect(isPendingInvite({ status: 'SUSPENDED', lastLoginAt: null })).toBe(false);
  });

  it('stores a fresh hashed token, 7-day expiry, and mails the raw token', async () => {
    prismaMock.user.findUnique.mockResolvedValue(staff);
    await authService.resendStaffInvite('s1', roles);

    const data = prismaMock.user.update.mock.calls[0]![0].data;
    const sent = mailSend.mock.calls[0]![0];
    expect(sent.template).toBe('invite-staff');
    const raw = String(sent.data.inviteUrl).split('/reset-password/')[1]!;
    expect(data.passwordResetToken).toBe(hashToken(raw));
    expect(data.passwordResetToken).not.toBe(raw);
    const days = (data.passwordResetExpiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('refuses non-staff and people who have already signed in', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...staff, role: 'STUDENT' });
    await expect(authService.resendStaffInvite('s1', roles)).rejects.toThrow(/staff/);
    prismaMock.user.findUnique.mockResolvedValue({ ...staff, lastLoginAt: new Date() });
    await expect(authService.resendStaffInvite('s1', roles)).rejects.toThrow(/already signed in/);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe('referral attribution', () => {
  const REF = 'WYL-STU-ABC234';
  const base = { fullName: 'New Person', email: 'new@b.co', password: 'Passw0rdPassw0rd' };

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'n1', email: base.email, fullName: base.fullName, studentProfile: { id: 'p', reference: 'x' },
    });
  });

  it('normalises and rejects malformed references', () => {
    expect(normaliseReferralRef(' wyl-stu-abc234 ')).toBe(REF);
    expect(normaliseReferralRef('WYL-STU-ABC10O')).toBeUndefined();
    expect(normaliseReferralRef('x'.repeat(60))).toBeUndefined();
    expect(normaliseReferralRef(['a'])).toBeUndefined();
  });

  it('sets referredByStudentId on the new profile when the reference resolves', async () => {
    prismaMock.studentProfile.findUnique.mockResolvedValue({
      id: 'ref-profile', user: { email: 'friend@b.co', status: 'ACTIVE' },
    });
    await authService.register({ ...base, referralRef: REF });
    expect(prismaMock.user.create.mock.calls[0]![0].data.studentProfile.create.referredByStudentId).toBe('ref-profile');
  });

  it.each([
    ['unknown reference', null],
    ['self referral', { id: 'p', user: { email: base.email, status: 'ACTIVE' } }],
    ['suspended referrer', { id: 'p', user: { email: 'f@b.co', status: 'SUSPENDED' } }],
  ])('silently ignores %s', async (_n, found) => {
    prismaMock.studentProfile.findUnique.mockResolvedValue(found);
    await expect(authService.register({ ...base, referralRef: REF })).resolves.toEqual({ created: true });
    expect(prismaMock.user.create.mock.calls[0]![0].data.studentProfile.create.referredByStudentId).toBeNull();
  });

  it('schema drops a bad ref instead of failing signup', () => {
    const input = {
      ...base, passwordConfirmation: base.password, acceptTerms: 'on',
    };
    expect(registerSchema.parse({ ...input, ref: 'garbage' }).ref).toBeUndefined();
    expect(registerSchema.parse({ ...input, ref: ' wyl-stu-abc234' }).ref).toBe(REF);
    expect(registerSchema.parse(input).ref).toBeUndefined();
  });
});
