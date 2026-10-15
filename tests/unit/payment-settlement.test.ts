/**
 * Settlement in billingService.applyGatewayPaymentOutcome — amount/currency
 * enforcement and atomic idempotency. Prisma is replaced by a tiny in-memory
 * fake whose `updateMany` honours the status guard, which is the property the
 * real compare-and-set relies on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = {
  payment: { id: 'p1', status: 'PENDING', amountMinor: 50_000, currency: 'EUR', failureReason: null as string | null },
  invoice: { id: 'i1', totalMinor: 100_000, paidMinor: 0 },
};

let transactionHook: (() => void) | null = null;
const dispatch = vi.fn();
const record = vi.fn();

function makeTx() {
  return {
    payment: {
      updateMany: vi.fn(({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
        if (where.status && state.payment.status !== where.status) return Promise.resolve({ count: 0 });
        Object.assign(state.payment, data);
        return Promise.resolve({ count: 1 });
      }),
    },
    invoice: {
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ ...state.invoice })),
      update: vi.fn(({ data }: { data: { paidMinor: number } }) => {
        state.invoice.paidMinor = data.paidMinor;
        return Promise.resolve();
      }),
    },
  };
}

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    user: { findMany: vi.fn(() => Promise.resolve([{ id: 'staff1' }])) },
    invoice: { findUnique: vi.fn(() => Promise.resolve(null)) },
    payment: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          ...state.payment,
          invoice: {
            ...state.invoice,
            currency: 'EUR',
            studentProfileId: 'sp1',
            studentProfile: { userId: 'u1' },
          },
        }),
      ),
      updateMany: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.payment, data);
        return Promise.resolve({ count: 1 });
      }),
    },
    $transaction: vi.fn((fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      transactionHook?.();
      transactionHook = null;
      return fn(makeTx());
    }),
  },
}));
vi.mock('../../src/services/notification.service.js', () => ({
  notificationService: { dispatch: (...a: unknown[]) => dispatch(...a) },
}));
vi.mock('../../src/services/audit.service.js', () => ({
  auditService: { record: (...a: unknown[]) => record(...a) },
}));
vi.mock('../../src/services/storage.service.js', () => ({ storageService: {} }));

describe('billingService.applyGatewayPaymentOutcome settlement', () => {
  beforeEach(() => {
    state.payment = { id: 'p1', status: 'PENDING', amountMinor: 50_000, currency: 'EUR', failureReason: null };
    state.invoice = { id: 'i1', totalMinor: 100_000, paidMinor: 0 };
    transactionHook = null;
    dispatch.mockReset();
    record.mockReset();
  });

  it('settles when the reported amount and currency match (case-insensitive currency)', async () => {
    const { billingService } = await import('../../src/services/billing.service.js');
    const result = await billingService.applyGatewayPaymentOutcome({
      providerReference: 'r',
      outcome: 'SUCCEEDED',
      gatewayReported: { amountMinor: 50_000, currency: 'eur' },
    });

    expect(result.applied).toBe(true);
    expect(state.payment.status).toBe('SUCCEEDED');
    expect(state.invoice.paidMinor).toBe(50_000);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('refuses and flags the payment on an amount mismatch', async () => {
    const { billingService } = await import('../../src/services/billing.service.js');
    const result = await billingService.applyGatewayPaymentOutcome({
      providerReference: 'r',
      outcome: 'SUCCEEDED',
      gatewayReported: { amountMinor: 1, currency: 'EUR' },
    });

    expect(result).toEqual({ applied: false, flagged: true });
    expect(state.payment.status).toBe('PENDING');
    expect(state.payment.failureReason).toMatch(/review/i);
    expect(state.invoice.paidMinor).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses on a currency mismatch', async () => {
    const { billingService } = await import('../../src/services/billing.service.js');
    const result = await billingService.applyGatewayPaymentOutcome({
      providerReference: 'r',
      outcome: 'SUCCEEDED',
      gatewayReported: { amountMinor: 50_000, currency: 'USD' },
    });

    expect(result.applied).toBe(false);
    expect(state.invoice.paidMinor).toBe(0);
  });

  it('a replayed delivery does not double-apply paidMinor or re-notify', async () => {
    const { billingService } = await import('../../src/services/billing.service.js');
    const input = {
      providerReference: 'r',
      outcome: 'SUCCEEDED' as const,
      gatewayReported: { amountMinor: 50_000, currency: 'EUR' },
    };

    await billingService.applyGatewayPaymentOutcome(input);
    const second = await billingService.applyGatewayPaymentOutcome(input);

    expect(second.applied).toBe(false);
    expect(state.invoice.paidMinor).toBe(50_000);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('a concurrent delivery that read PENDING loses the atomic claim and applies nothing', async () => {
    const { billingService } = await import('../../src/services/billing.service.js');
    // Simulate the race: both deliveries read PENDING, then another one wins
    // the claim before this one's transaction runs.
    transactionHook = () => {
      state.payment.status = 'SUCCEEDED';
    };

    const result = await billingService.applyGatewayPaymentOutcome({
      providerReference: 'r',
      outcome: 'SUCCEEDED',
      gatewayReported: { amountMinor: 50_000, currency: 'EUR' },
    });

    expect(result.applied).toBe(false);
    expect(state.invoice.paidMinor).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('records an overpay (error + audit) instead of silently clamping', async () => {
    const { billingService } = await import('../../src/services/billing.service.js');
    state.invoice.paidMinor = 80_000; // a manual payment landed first; 30k too much

    const result = await billingService.applyGatewayPaymentOutcome({
      providerReference: 'r',
      outcome: 'SUCCEEDED',
      gatewayReported: { amountMinor: 50_000, currency: 'EUR' },
    });

    expect(result.applied).toBe(true);
    expect(state.invoice.paidMinor).toBe(100_000);
    expect(state.payment.failureReason).toMatch(/Overpaid by 30000/);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'staff1', title: expect.stringContaining('Overpayment') }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ changes: expect.objectContaining({ overpaidMinor: 30_000 }) }),
    );
  });

  it('a late success webhook reopens a checkout we expired as abandoned', async () => {
    const { billingService } = await import('../../src/services/billing.service.js');
    state.payment.status = 'FAILED';
    state.payment.failureReason = 'Checkout abandoned — expired without a gateway confirmation.';

    const result = await billingService.applyGatewayPaymentOutcome({
      providerReference: 'r',
      outcome: 'SUCCEEDED',
      gatewayReported: { amountMinor: 50_000, currency: 'EUR' },
    });

    expect(result.applied).toBe(true);
    expect(state.payment.status).toBe('SUCCEEDED');
    expect(state.invoice.paidMinor).toBe(50_000);
  });

  it('a FAILED payment with any other reason stays closed', async () => {
    const { billingService } = await import('../../src/services/billing.service.js');
    state.payment.status = 'FAILED';
    state.payment.failureReason = 'Declined by the payment gateway.';

    const result = await billingService.applyGatewayPaymentOutcome({
      providerReference: 'r',
      outcome: 'SUCCEEDED',
    });

    expect(result.applied).toBe(false);
    expect(state.invoice.paidMinor).toBe(0);
  });
});
