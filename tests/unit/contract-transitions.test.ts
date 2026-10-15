import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { status: 'AWAITING_SIGNATURE', signedAt: null as Date | null };
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock('../../src/config/database.js', () => {
  const contract = {
    findUnique: vi.fn(() =>
      Promise.resolve({ id: 'c1', status: state.status, studentProfileId: 's1', title: 'Agreement', studentProfile: { userId: 'u1' } }),
    ),
    updateMany: vi.fn(({ where, data }: { where: { status?: string; signedAt?: null }; data: Record<string, unknown> }) => {
      if (where.status && where.status !== state.status) return Promise.resolve({ count: 0 });
      if (where.signedAt === null && state.signedAt) return Promise.resolve({ count: 0 });
      if (data.status) state.status = data.status as string;
      if (data.signedAt) state.signedAt = data.signedAt as Date;
      return Promise.resolve({ count: 1 });
    }),
    findUniqueOrThrow: vi.fn(() => Promise.resolve({ id: 'c1', status: state.status, signedAt: state.signedAt })),
  };
  return {
    prisma: {
      contract,
      $transaction: (fn: (tx: unknown) => unknown) => fn({ contract }),
    },
  };
});
vi.mock('../../src/services/notification.service.js', () => ({ notificationService: { dispatch } }));
vi.mock('../../src/services/audit.service.js', () => ({ auditService: { record: vi.fn() } }));
vi.mock('../../src/services/storage.service.js', () => ({ storageService: {} }));

import {
  canTransitionContract,
  contractService,
  contractStatusTitle,
} from '../../src/services/contract.service.js';

beforeEach(() => {
  state.status = 'AWAITING_SIGNATURE';
  state.signedAt = null;
  dispatch.mockClear();
});

describe('contract transitions', () => {
  it('allows only forward moves', () => {
    expect(canTransitionContract('AWAITING_SIGNATURE', 'SIGNED')).toBe(true);
    expect(canTransitionContract('SIGNED', 'ACTIVE')).toBe(true);
    expect(canTransitionContract('AWAITING_SIGNATURE', 'ACTIVE')).toBe(false);
    expect(canTransitionContract('ACTIVE', 'SIGNED')).toBe(false);
    expect(canTransitionContract('SIGNED', 'SIGNED')).toBe(false);
  });

  it('rejects illegal moves with a ValidationError and does not notify', async () => {
    await expect(
      contractService.updateStatus({ contractId: 'c1', status: 'ACTIVE', actorId: 'a1' }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(dispatch).not.toHaveBeenCalled();
    expect(state.status).toBe('AWAITING_SIGNATURE');
  });

  it('stamps signedAt on signing and notifies', async () => {
    await contractService.updateStatus({ contractId: 'c1', status: 'SIGNED', actorId: 'a1' });
    expect(state.status).toBe('SIGNED');
    expect(state.signedAt).toBeInstanceOf(Date);
    expect(dispatch.mock.calls[0]![0].title).toBe('Agreement is now signed');
  });

  it('uses accurate copy per status and a safe fallback', () => {
    expect(contractStatusTitle('X', 'AWAITING_SIGNATURE')).toBe('X is now awaiting your signature');
    expect(contractStatusTitle('X', 'ACTIVE')).toBe('X is now active');
    expect(contractStatusTitle('X', 'CANCELLED' as never)).toBe('X is now marked cancelled');
  });
});
