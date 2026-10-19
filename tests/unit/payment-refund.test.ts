/**
 * Refunds: gateway client calls (mocked fetch) and billingService.refundPayment
 * bookkeeping (in-memory Prisma fake).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/config/env.js', () => ({
  env: {
    PAYSTACK_SECRET_KEY: 'sk_test_ps',
    FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-x',
    STRIPE_SECRET_KEY: undefined,
    APP_URL: 'http://localhost:3000',
  },
}));

vi.mock('../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const state = {
  role: 'ADMIN_STAFF',
  payment: {
    id: 'p1',
    status: 'SUCCEEDED',
    amountMinor: 50_000,
    currency: 'EUR',
    provider: 'paystack' as string | null,
    providerReference: 'wyl_ps_1' as string | null,
    refundedMinor: 0,
  },
  invoice: { id: 'i1', totalMinor: 50_000, paidMinor: 50_000, status: 'PAID', dueAt: null as Date | null },
  others: 0,
};
const refundGateway = vi.fn();
const dispatch = vi.fn();
const record = vi.fn();

vi.mock('../../src/services/payments/gateway.service.js', () => ({
  refundGatewayPayment: (...a: unknown[]) => refundGateway(...a),
}));
vi.mock('../../src/services/notification.service.js', () => ({
  notificationService: { dispatch: (...a: unknown[]) => dispatch(...a) },
}));
vi.mock('../../src/services/audit.service.js', () => ({
  auditService: { record: (...a: unknown[]) => record(...a) },
}));
vi.mock('../../src/services/storage.service.js', () => ({ storageService: {} }));

vi.mock('../../src/config/database.js', () => {
  const tx = {
    payment: {
      aggregate: vi.fn(() =>
        Promise.resolve({
          _sum: {
            amountMinor: state.others + (state.payment.status === 'SUCCEEDED' ? state.payment.amountMinor : 0),
            refundedMinor: state.payment.status === 'SUCCEEDED' ? state.payment.refundedMinor : 0,
          },
        }),
      ),
    },
    invoice: {
      update: vi.fn(({ data }: { data: { paidMinor: number; status: string } }) => {
        Object.assign(state.invoice, data);
        return Promise.resolve();
      }),
    },
  };
  return {
    prisma: {
      user: { findUnique: vi.fn(() => Promise.resolve({ role: state.role })) },
      invoice: { findUnique: vi.fn(() => Promise.resolve(null)) },
      payment: {
        findUnique: vi.fn(() =>
          Promise.resolve({
            ...state.payment,
            invoice: {
              id: 'i1',
              totalMinor: state.invoice.totalMinor,
              dueAt: state.invoice.dueAt,
              studentProfileId: 'sp1',
              studentProfile: { userId: 'u1' },
            },
          }),
        ),
        updateMany: vi.fn(
          ({
            where,
            data,
          }: {
            where: { status?: string; refundedMinor?: number };
            data: { status?: string; refundedMinor?: { increment?: number; decrement?: number } };
          }) => {
            if (where.status && where.status !== state.payment.status) return Promise.resolve({ count: 0 });
            if (where.refundedMinor !== undefined && where.refundedMinor !== state.payment.refundedMinor) {
              return Promise.resolve({ count: 0 });
            }
            if (data.status) state.payment.status = data.status;
            state.payment.refundedMinor +=
              (data.refundedMinor?.increment ?? 0) - (data.refundedMinor?.decrement ?? 0);
            return Promise.resolve({ count: 1 });
          },
        ),
      },
      $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});

const { billingService } = await import('../../src/services/billing.service.js');
const { refundPaystackPayment } = await import('../../src/services/payments/paystack.client.js');
const { refundFlutterwavePayment } = await import('../../src/services/payments/flutterwave.client.js');

beforeEach(() => {
  state.role = 'ADMIN_STAFF';
  state.payment = {
    id: 'p1',
    status: 'SUCCEEDED',
    amountMinor: 50_000,
    currency: 'EUR',
    provider: 'paystack',
    providerReference: 'wyl_ps_1',
    refundedMinor: 0,
  };
  state.invoice = { id: 'i1', totalMinor: 50_000, paidMinor: 50_000, status: 'PAID', dueAt: null };
  state.others = 0;
  refundGateway.mockReset().mockResolvedValue({ refundReference: 'rf_1' });
  dispatch.mockReset();
  record.mockReset();
});

describe('billingService.refundPayment', () => {
  it('refunds in full: payment REFUNDED, invoice REFUNDED, audited', async () => {
    const result = await billingService.refundPayment('p1', 'admin1');

    expect(refundGateway).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'paystack', providerReference: 'wyl_ps_1', amountMinor: 50_000 }),
    );
    expect(state.payment.status).toBe('REFUNDED');
    expect(state.invoice).toMatchObject({ paidMinor: 0, status: 'REFUNDED' });
    expect(result.full).toBe(true);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'admin1', entity: 'Payment' }));
  });

  it('partial refund records refundedMinor, keeps the payment SUCCEEDED and the invoice PARTIALLY_PAID', async () => {
    const result = await billingService.refundPayment('p1', 'admin1', 10_000);

    expect(refundGateway).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 10_000 }));
    expect(state.payment).toMatchObject({ status: 'SUCCEEDED', refundedMinor: 10_000 });
    expect(state.invoice).toMatchObject({ paidMinor: 40_000, status: 'PARTIALLY_PAID' });
    expect(result.full).toBe(false);
  });

  it('allows repeated partials up to the remainder, then marks the payment REFUNDED', async () => {
    await billingService.refundPayment('p1', 'admin1', 10_000);
    await billingService.refundPayment('p1', 'admin1', 15_000);
    expect(state.payment).toMatchObject({ status: 'SUCCEEDED', refundedMinor: 25_000 });
    expect(state.invoice).toMatchObject({ paidMinor: 25_000, status: 'PARTIALLY_PAID' });

    // Same amount twice must not reuse an idempotency key.
    const keys = refundGateway.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys).size).toBe(2);

    await expect(billingService.refundPayment('p1', 'admin1', 25_001)).rejects.toThrow(/between 1 and 25000/);
    const last = await billingService.refundPayment('p1', 'admin1');
    expect(last.full).toBe(true);
    expect(state.payment).toMatchObject({ status: 'REFUNDED', refundedMinor: 50_000 });
    expect(state.invoice).toMatchObject({ paidMinor: 0, status: 'REFUNDED' });
  });

  it('a partial refund on an invoice past its due date moves it to OVERDUE', async () => {
    state.invoice.dueAt = new Date('2020-01-01');
    await billingService.refundPayment('p1', 'admin1', 10_000);
    expect(state.invoice.status).toBe('OVERDUE');
  });

  it('rejects zero, negative and fractional amounts without touching the gateway', async () => {
    for (const bad of [0, -5, 10.5]) {
      await expect(billingService.refundPayment('p1', 'admin1', bad)).rejects.toThrow(/between/);
    }
    expect(refundGateway).not.toHaveBeenCalled();
    expect(state.payment.refundedMinor).toBe(0);
  });

  it('refunding an overpaid payment down to the total keeps the invoice PAID', async () => {
    state.payment.amountMinor = 60_000; // 10k over the 50k invoice
    await billingService.refundPayment('p1', 'admin1', 10_000);
    expect(state.invoice).toMatchObject({ paidMinor: 50_000, status: 'PAID' });
  });

  it('rolls the claim back when the gateway refuses', async () => {
    refundGateway.mockRejectedValueOnce(new Error('gateway down'));
    await expect(billingService.refundPayment('p1', 'admin1')).rejects.toThrow('gateway down');
    expect(state.payment).toMatchObject({ status: 'SUCCEEDED', refundedMinor: 0 });
    expect(state.invoice.status).toBe('PAID');
  });

  it('rejects non-admins, manual payments, non-SUCCEEDED payments and bad amounts', async () => {
    state.role = 'COUNSELLOR';
    await expect(billingService.refundPayment('p1', 'c1')).rejects.toThrow(/administrators/);

    state.role = 'SUPER_ADMIN';
    state.payment.provider = null;
    await expect(billingService.refundPayment('p1', 'a')).rejects.toThrow(/online card/);

    state.payment.provider = 'paystack';
    state.payment.status = 'PENDING';
    await expect(billingService.refundPayment('p1', 'a')).rejects.toThrow(/successful/);

    state.payment.status = 'SUCCEEDED';
    await expect(billingService.refundPayment('p1', 'a', 50_001)).rejects.toThrow(/between/);
    expect(refundGateway).not.toHaveBeenCalled();
  });
});

describe('gateway refund clients', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

  it('Paystack POSTs /refund with a timeout signal', async () => {
    fetchMock.mockReturnValueOnce(ok({ status: true, data: { id: 77 } }));
    const result = await refundPaystackPayment({
      providerReference: 'wyl_ps_1', amountMinor: 1000, currency: 'NGN', idempotencyKey: 'k',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.paystack.co/refund');
    expect(JSON.parse(init.body)).toMatchObject({ transaction: 'wyl_ps_1', amount: 1000 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result.refundReference).toBe('77');
  });

  it('Paystack surfaces an API refusal as an error', async () => {
    fetchMock.mockReturnValueOnce(ok({ status: false, message: 'Transaction not found' }));
    await expect(
      refundPaystackPayment({ providerReference: 'x', amountMinor: 1, currency: 'NGN', idempotencyKey: 'k' }),
    ).rejects.toThrow(/Transaction not found/);
  });

  it('Flutterwave resolves the numeric id, then refunds in major units', async () => {
    fetchMock
      .mockReturnValueOnce(ok({ status: 'success', data: { id: 4242 } }))
      .mockReturnValueOnce(ok({ status: 'success', data: { id: 9 } }));
    const result = await refundFlutterwavePayment({
      providerReference: 'wyl_fw_1', amountMinor: 12_345, currency: 'GHS', idempotencyKey: 'k',
    });
    expect(fetchMock.mock.calls[0]![0]).toContain('verify_by_reference?tx_ref=wyl_fw_1');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.flutterwave.com/v3/transactions/4242/refund');
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ amount: '123.45' });
    expect(result.refundReference).toBe('9');
  });

  it('Flutterwave turns a network failure into a service error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      refundFlutterwavePayment({ providerReference: 'x', amountMinor: 1, currency: 'GHS', idempotencyKey: 'k' }),
    ).rejects.toThrow(/refund request failed/);
  });
});
