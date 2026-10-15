/**
 * privacyService: anonymisation keeps financial rows, strips PII, revokes
 * sessions; export omits storage keys. In-memory Prisma fake.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = {
  user: {} as Record<string, unknown>,
  sessions: [] as { userId: string; revokedAt: Date | null }[],
  tokens: [] as { userId: string; revokedAt: Date | null }[],
  invoices: [{ id: 'inv1' }],
  audit: [] as Record<string, unknown>[],
  enquiries: [] as Record<string, unknown>[],
  documentSelect: null as Record<string, boolean> | null,
};

function makeTx() {
  return {
    user: {
      update: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.user, data);
        return Promise.resolve();
      }),
    },
    session: {
      updateMany: vi.fn(({ data }: { data: { revokedAt: Date } }) => {
        state.sessions.forEach((s) => !s.revokedAt && (s.revokedAt = data.revokedAt));
        return Promise.resolve({ count: 1 });
      }),
    },
    refreshToken: {
      updateMany: vi.fn(({ data }: { data: { revokedAt: Date } }) => {
        state.tokens.forEach((s) => !s.revokedAt && (s.revokedAt = data.revokedAt));
        return Promise.resolve({ count: 1 });
      }),
    },
    studentProfile: { update: vi.fn(() => Promise.resolve()) },
    enquiry: { updateMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    auditLog: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        state.audit.push(data);
        return Promise.resolve();
      }),
    },
  };
}

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(() => Promise.resolve(state.user)) },
    document: {
      findMany: vi.fn(({ select }: { select: Record<string, boolean> }) => {
        state.documentSelect = select;
        return Promise.resolve([]);
      }),
    },
    application: { findMany: vi.fn(() => Promise.resolve([])) },
    appointment: { findMany: vi.fn(() => Promise.resolve([])) },
    invoice: { findMany: vi.fn(() => Promise.resolve(state.invoices)) },
    message: { findMany: vi.fn(() => Promise.resolve([])) },
    supportTicket: { findMany: vi.fn(() => Promise.resolve([])) },
    notification: { findMany: vi.fn(() => Promise.resolve([])) },
    $transaction: vi.fn((fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx())),
  },
}));

import { privacyService } from '../../src/services/privacy.service.js';

beforeEach(() => {
  state.user = {
    id: 'u1',
    email: 'jane@example.org',
    fullName: 'Jane',
    role: 'STUDENT',
    status: 'ACTIVE',
    studentProfile: { id: 'sp1' },
  };
  state.sessions = [{ userId: 'u1', revokedAt: null }];
  state.tokens = [{ userId: 'u1', revokedAt: null }];
  state.audit = [];
  state.documentSelect = null;
});

describe('anonymiseUser', () => {
  it('replaces PII, archives, revokes sessions, leaves invoices', async () => {
    const out = await privacyService.anonymiseUser('u1', 'admin1');

    expect(out.alreadyAnonymised).toBe(false);
    expect(state.user).toMatchObject({
      email: 'deleted-u1@invalid',
      fullName: 'Deleted user',
      phone: null,
      mfaSecret: null,
      passwordResetToken: null,
      verificationToken: null,
      status: 'ARCHIVED',
    });
    expect(state.sessions[0]!.revokedAt).toBeInstanceOf(Date);
    expect(state.tokens[0]!.revokedAt).toBeInstanceOf(Date);
    expect(state.invoices).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ action: 'ANONYMISE', actorId: 'admin1', entityId: 'u1' });
  });

  it('is idempotent for an already anonymised account', async () => {
    state.user.email = 'deleted-u1@invalid';
    const out = await privacyService.anonymiseUser('u1', 'admin1');
    expect(out.alreadyAnonymised).toBe(true);
    expect(state.audit).toHaveLength(0);
  });

  it('refuses self-anonymisation and super admins', async () => {
    await expect(privacyService.anonymiseUser('u1', 'u1')).rejects.toThrow();
    state.user.role = 'SUPER_ADMIN';
    await expect(privacyService.anonymiseUser('u1', 'admin1')).rejects.toThrow();
  });
});

describe('exportUserData', () => {
  it('never selects storage keys for documents', async () => {
    const data = await privacyService.exportUserData('u1');
    expect(state.documentSelect).not.toHaveProperty('storageKey');
    expect(state.documentSelect).not.toHaveProperty('encryptionIv');
    expect(data.invoices).toHaveLength(1);
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining(['profile', 'applications', 'documents', 'appointments', 'invoices', 'messages', 'tickets', 'notifications']),
    );
  });
});
