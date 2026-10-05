/**
 * Gateway routing + the "not configured" fallback (PRD §8.1, phase 3).
 *
 * `env` is a module-level singleton parsed once from `process.env`, so each
 * test resets the module registry and re-imports after mutating
 * `process.env` directly, rather than relying on whatever gateway keys
 * happen to be set in the host's own environment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('payment gateway selection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.PAYSTACK_SECRET_KEY;
    delete process.env.FLUTTERWAVE_SECRET_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('selectGateway', () => {
    it('routes NGN invoices to Paystack', async () => {
      const { selectGateway } = await import('../../src/services/payments/gateway.service.js');
      expect(selectGateway('NGN')).toBe('paystack');
      expect(selectGateway('ngn')).toBe('paystack');
    });

    it('routes other African currencies to Flutterwave', async () => {
      const { selectGateway } = await import('../../src/services/payments/gateway.service.js');
      expect(selectGateway('GHS')).toBe('flutterwave');
      expect(selectGateway('KES')).toBe('flutterwave');
      expect(selectGateway('ZAR')).toBe('flutterwave');
      expect(selectGateway('XOF')).toBe('flutterwave');
    });

    it('falls back to Stripe for EUR/USD/GBP and any unrecognised currency', async () => {
      const { selectGateway } = await import('../../src/services/payments/gateway.service.js');
      expect(selectGateway('EUR')).toBe('stripe');
      expect(selectGateway('USD')).toBe('stripe');
      expect(selectGateway('GBP')).toBe('stripe');
      expect(selectGateway('XYZ')).toBe('stripe');
    });
  });

  describe('createCheckoutSession — unconfigured gateway guard', () => {
    const baseInput = {
      invoiceId: 'inv_1',
      invoiceNumber: 'INV-2026-00001',
      amountMinor: 10_000,
      studentEmail: 'student@example.com',
      studentName: 'Student Name',
    };

    it('returns null for a EUR invoice when STRIPE_SECRET_KEY is not configured', async () => {
      const { createCheckoutSession } = await import('../../src/services/payments/gateway.service.js');
      const session = await createCheckoutSession({ ...baseInput, currency: 'EUR' });
      expect(session).toBeNull();
    });

    it('returns null for an NGN invoice when PAYSTACK_SECRET_KEY is not configured', async () => {
      const { createCheckoutSession } = await import('../../src/services/payments/gateway.service.js');
      const session = await createCheckoutSession({ ...baseInput, currency: 'NGN' });
      expect(session).toBeNull();
    });

    it('returns null for a GHS invoice when FLUTTERWAVE_SECRET_KEY is not configured', async () => {
      const { createCheckoutSession } = await import('../../src/services/payments/gateway.service.js');
      const session = await createCheckoutSession({ ...baseInput, currency: 'GHS' });
      expect(session).toBeNull();
    });
  });
});
