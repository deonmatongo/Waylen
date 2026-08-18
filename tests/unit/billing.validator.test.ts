import { describe, it, expect } from 'vitest';
import {
  submitProofOfPaymentSchema,
  createInvoiceSchema,
  rejectPaymentSchema,
} from '../../src/validators/billing.validator.js';

describe('submitProofOfPaymentSchema', () => {
  it('accepts a valid manual payment claim', () => {
    const result = submitProofOfPaymentSchema.safeParse({
      method: 'BANK_TRANSFER',
      amountMinor: '5000',
      manualReference: 'TRF-001',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amountMinor).toBe(5000);
  });

  it('rejects a gateway-only method — card payments never arrive as a manual claim', () => {
    const result = submitProofOfPaymentSchema.safeParse({ method: 'CARD', amountMinor: '5000' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive amount', () => {
    const result = submitProofOfPaymentSchema.safeParse({ method: 'CASH', amountMinor: '0' });
    expect(result.success).toBe(false);
  });
});

describe('createInvoiceSchema', () => {
  const validInvoice = {
    studentProfileId: 'ckv1x0000000000000000000',
    lineItems: [{ description: 'Application fee', quantity: '1', unitPriceMinor: '5000' }],
  };

  it('accepts an invoice with a blank due date and currency (form defaults)', () => {
    const result = createInvoiceSchema.safeParse({ ...validInvoice, dueAt: '', currency: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dueAt).toBeUndefined();
      expect(result.data.currency).toBeUndefined();
    }
  });

  it('rejects an invoice with no line items', () => {
    const result = createInvoiceSchema.safeParse({ ...validInvoice, lineItems: [] });
    expect(result.success).toBe(false);
  });
});

describe('rejectPaymentSchema', () => {
  it('requires an explanation long enough to act on', () => {
    expect(rejectPaymentSchema.safeParse({ reason: 'no' }).success).toBe(false);
    expect(rejectPaymentSchema.safeParse({ reason: 'Receipt amount does not match' }).success).toBe(true);
  });
});
