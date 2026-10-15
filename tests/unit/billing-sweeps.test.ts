/**
 * Invoice number retry, overdue reminder idempotency, stale checkout expiry,
 * and the overpay record in settlement.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const invoiceCreate = vi.fn();
const invoiceFindFirst = vi.fn();
const invoiceUpdateMany = vi.fn();
const paymentUpdateMany = vi.fn();
const dispatch = vi.fn();

vi.mock('../../src/services/notification.service.js', () => ({
  notificationService: { dispatch: (...a: unknown[]) => dispatch(...a) },
}));
vi.mock('../../src/services/audit.service.js', () => ({ auditService: { record: vi.fn() } }));
vi.mock('../../src/services/storage.service.js', () => ({ storageService: {} }));
vi.mock('../../src/services/payments/gateway.service.js', () => ({ refundGatewayPayment: vi.fn() }));

vi.mock('../../src/config/database.js', () => {
  const tx = { invoice: { findFirst: (...a: unknown[]) => invoiceFindFirst(...a), create: (...a: unknown[]) => invoiceCreate(...a) } };
  return {
    prisma: {
      $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      invoice: {
        findUnique: vi.fn(() =>
          Promise.resolve({ number: 'INV-1', studentProfileId: 'sp', studentProfile: { userId: 'u1' } }),
        ),
        updateMany: (...a: unknown[]) => invoiceUpdateMany(...a),
      },
      payment: { updateMany: (...a: unknown[]) => paymentUpdateMany(...a) },
    },
  };
});

const { billingService } = await import('../../src/services/billing.service.js');

const input = {
  studentProfileId: 'sp',
  lineItems: [{ description: 'x', quantity: 1, unitPriceMinor: 100 }],
};

beforeEach(() => {
  [invoiceCreate, invoiceFindFirst, invoiceUpdateMany, paymentUpdateMany, dispatch].forEach((m) => m.mockReset());
});

describe('invoice number allocation', () => {
  const year = new Date().getFullYear();

  it('uses max sequence + 1, not a count', async () => {
    invoiceFindFirst.mockResolvedValue({ number: `INV-${year}-00041` });
    invoiceCreate.mockResolvedValue({ id: 'i' });
    await billingService.createInvoice(input);
    expect(invoiceCreate.mock.calls[0]![0].data.number).toBe(`INV-${year}-00042`);
  });

  it('retries a unique violation and gives up after 3 attempts', async () => {
    invoiceFindFirst.mockResolvedValue(null);
    invoiceCreate
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
      .mockResolvedValueOnce({ id: 'i' });
    await expect(billingService.createInvoice(input)).resolves.toEqual({ id: 'i' });
    expect(invoiceCreate).toHaveBeenCalledTimes(2);

    invoiceCreate.mockReset().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(billingService.createInvoice(input)).rejects.toThrow('dup');
    expect(invoiceCreate).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors', async () => {
    invoiceFindFirst.mockResolvedValue(null);
    invoiceCreate.mockRejectedValue(new Error('boom'));
    await expect(billingService.createInvoice(input)).rejects.toThrow('boom');
    expect(invoiceCreate).toHaveBeenCalledTimes(1);
  });
});

describe('reminders', () => {
  it('sends nothing when the interval claim is lost (already reminded)', async () => {
    invoiceUpdateMany.mockResolvedValue({ count: 0 });
    expect(await billingService.recordReminderSent('i1', { minIntervalDays: 3 })).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('claims with a cutoff and sends once when due', async () => {
    invoiceUpdateMany.mockResolvedValue({ count: 1 });
    expect(await billingService.recordReminderSent('i1', { minIntervalDays: 3 })).toBe(true);
    const where = invoiceUpdateMany.mock.calls[0]![0].where;
    expect(where.OR[0]).toEqual({ reminderSentAt: null });
    expect(where.OR[1].reminderSentAt.lt).toBeInstanceOf(Date);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ event: 'invoice.reminder' }));
  });
});

describe('expireStalePendingPayments', () => {
  it('only touches PENDING gateway rows (provider set) older than the cutoff', async () => {
    paymentUpdateMany.mockResolvedValue({ count: 2 });
    expect(await billingService.expireStalePendingPayments(48)).toBe(2);
    const { where, data } = paymentUpdateMany.mock.calls[0]![0];
    expect(where).toMatchObject({ status: 'PENDING', provider: { not: null } });
    expect(Date.now() - where.createdAt.lt.getTime()).toBeGreaterThanOrEqual(48 * 3_600_000 - 1000);
    expect(data.status).toBe('FAILED');
  });
});
