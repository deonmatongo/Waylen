/**
 * Webhook signature verification + event routing (PRD §8.1, phase 2).
 *
 * `billingService` is mocked so these are pure controller tests: no DB, no
 * gateway network calls. Each gateway's signature scheme is exercised with a
 * genuinely valid signature (computed the same way the real provider would)
 * and a tampered one, to prove verification actually checks the body rather
 * than merely checking a header is present.
 */
import crypto from 'node:crypto';
import Stripe from 'stripe';
import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const STRIPE_WEBHOOK_SECRET = 'whsec_test_0000000000000000000000000000000000000000';
const PAYSTACK_SECRET_KEY = 'sk_test_paystack_0000000000000000000000';
const FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST-0000000000000000000000000000-X';

const applyGatewayPaymentOutcome = vi.fn();

const verifyPaystackTransaction = vi.fn();
const verifyFlutterwaveTransaction = vi.fn();

vi.mock('../../src/services/payments/paystack.client.js', () => ({
  verifyPaystackTransaction: (...args: unknown[]) => verifyPaystackTransaction(...args),
}));
vi.mock('../../src/services/payments/flutterwave.client.js', () => ({
  verifyFlutterwaveTransaction: (...args: unknown[]) => verifyFlutterwaveTransaction(...args),
}));

vi.mock('../../src/services/billing.service.js', () => ({
  billingService: {
    applyGatewayPaymentOutcome: (...args: unknown[]) => applyGatewayPaymentOutcome(...args),
  },
}));

function mockReq(headers: Record<string, string | undefined>, body: Buffer): Request {
  return {
    get: (name: string) => headers[name.toLowerCase()],
    body,
  } as unknown as Request;
}

/**
 * Deliberately NOT typed as Express's `Response` — a property typed as one of
 * its methods (which carry a `this` type) read back out for `expect(...)`
 * trips `@typescript-eslint/no-unbound-method` as a false positive. A plain
 * object with the two methods the controllers actually call sidesteps that
 * while still asserting the same thing.
 */
function mockRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json };
}

function asResponse(res: ReturnType<typeof mockRes>): Response {
  return res as unknown as Response;
}

describe('payment gateway webhooks', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    applyGatewayPaymentOutcome.mockReset();
    verifyPaystackTransaction.mockReset();
    verifyFlutterwaveTransaction.mockReset();
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
    process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET_KEY;
    process.env.FLUTTERWAVE_SECRET_KEY = FLUTTERWAVE_SECRET_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Stripe', () => {
    it('rejects a payload whose signature was not produced by the configured secret', async () => {
      const { stripe } = await import('../../src/controllers/webhooks/payment.controller.js');

      const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
      const badSignature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: 'whsec_some_other_secret_entirely_0000000000000',
      });

      const req = mockReq({ 'stripe-signature': badSignature }, Buffer.from(payload));
      const res = mockRes();

      await stripe(req, asResponse(res));

      expect(res.status).toHaveBeenCalledWith(400);
      expect(applyGatewayPaymentOutcome).not.toHaveBeenCalled();
    });

    it('rejects a request with no signature header at all', async () => {
      const { stripe } = await import('../../src/controllers/webhooks/payment.controller.js');
      const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });

      const req = mockReq({}, Buffer.from(payload));
      const res = mockRes();

      await stripe(req, asResponse(res));

      expect(res.status).toHaveBeenCalledWith(400);
      expect(applyGatewayPaymentOutcome).not.toHaveBeenCalled();
    });

    it('accepts a validly-signed checkout.session.completed event and applies a SUCCEEDED outcome', async () => {
      const { stripe } = await import('../../src/controllers/webhooks/payment.controller.js');

      const payload = JSON.stringify({
        id: 'evt_1',
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            object: 'checkout.session',
            payment_status: 'paid',
            amount_total: 50_000,
            currency: 'eur',
          },
        },
      });
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: STRIPE_WEBHOOK_SECRET,
      });

      const req = mockReq({ 'stripe-signature': signature }, Buffer.from(payload));
      const res = mockRes();

      await stripe(req, asResponse(res));

      expect(res.status).toHaveBeenCalledWith(202);
      expect(applyGatewayPaymentOutcome).toHaveBeenCalledWith({
        providerReference: 'cs_test_123',
        outcome: 'SUCCEEDED',
        gatewayReported: { amountMinor: 50_000, currency: 'eur' },
      });
    });

    function signedStripe(type: string, object: Record<string, unknown>) {
      const payload = JSON.stringify({
        id: 'evt_x',
        object: 'event',
        type,
        data: { object: { object: 'checkout.session', ...object } },
      });
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET });
      return mockReq({ 'stripe-signature': signature }, Buffer.from(payload));
    }

    it('does not settle checkout.session.completed while payment_status is unpaid', async () => {
      const { stripe } = await import('../../src/controllers/webhooks/payment.controller.js');
      const res = mockRes();

      await stripe(
        signedStripe('checkout.session.completed', {
          id: 'cs_unpaid',
          payment_status: 'unpaid',
          amount_total: 50_000,
          currency: 'eur',
        }),
        asResponse(res),
      );

      expect(res.status).toHaveBeenCalledWith(202);
      expect(applyGatewayPaymentOutcome).not.toHaveBeenCalled();
    });

    it('settles checkout.session.async_payment_succeeded regardless of payment_status', async () => {
      const { stripe } = await import('../../src/controllers/webhooks/payment.controller.js');
      const res = mockRes();

      await stripe(
        signedStripe('checkout.session.async_payment_succeeded', {
          id: 'cs_async',
          payment_status: 'unpaid',
          amount_total: 1_000,
          currency: 'usd',
        }),
        asResponse(res),
      );

      expect(applyGatewayPaymentOutcome).toHaveBeenCalledWith({
        providerReference: 'cs_async',
        outcome: 'SUCCEEDED',
        gatewayReported: { amountMinor: 1_000, currency: 'usd' },
      });
    });

    it('rejects a paid completed session that has no amount_total (forces a mismatch downstream)', async () => {
      const { stripe } = await import('../../src/controllers/webhooks/payment.controller.js');
      const res = mockRes();

      await stripe(
        signedStripe('checkout.session.completed', { id: 'cs_noamt', payment_status: 'paid' }),
        asResponse(res),
      );

      const arg = applyGatewayPaymentOutcome.mock.calls[0]?.[0] as {
        gatewayReported: { amountMinor: number };
      };
      expect(Number.isNaN(arg.gatewayReported.amountMinor)).toBe(true);
    });

    it('applies a FAILED outcome for an expired checkout session', async () => {
      const { stripe } = await import('../../src/controllers/webhooks/payment.controller.js');

      const payload = JSON.stringify({
        id: 'evt_2',
        object: 'event',
        type: 'checkout.session.expired',
        data: { object: { id: 'cs_test_456', object: 'checkout.session' } },
      });
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: STRIPE_WEBHOOK_SECRET,
      });

      const req = mockReq({ 'stripe-signature': signature }, Buffer.from(payload));
      const res = mockRes();

      await stripe(req, asResponse(res));

      expect(res.status).toHaveBeenCalledWith(202);
      expect(applyGatewayPaymentOutcome).toHaveBeenCalledWith({
        providerReference: 'cs_test_456',
        outcome: 'FAILED',
      });
    });

    it('ignores an event type it does not act on, without calling billingService', async () => {
      const { stripe } = await import('../../src/controllers/webhooks/payment.controller.js');

      const payload = JSON.stringify({
        id: 'evt_3',
        object: 'event',
        type: 'payment_intent.created',
        data: { object: { id: 'pi_test_789', object: 'payment_intent' } },
      });
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: STRIPE_WEBHOOK_SECRET,
      });

      const req = mockReq({ 'stripe-signature': signature }, Buffer.from(payload));
      const res = mockRes();

      await stripe(req, asResponse(res));

      expect(res.status).toHaveBeenCalledWith(202);
      expect(applyGatewayPaymentOutcome).not.toHaveBeenCalled();
    });
  });

  describe('Paystack', () => {
    it('rejects a tampered payload (signature computed over different bytes)', async () => {
      const { paystack } = await import('../../src/controllers/webhooks/payment.controller.js');

      const signedPayload = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_1' } }));
      const signature = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(signedPayload).digest('hex');

      // The body actually delivered differs from what was signed.
      const tamperedPayload = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_2' } }));

      const req = mockReq({ 'x-paystack-signature': signature }, tamperedPayload);
      const res = mockRes();

      await paystack(req, asResponse(res));

      expect(res.status).toHaveBeenCalledWith(400);
      expect(applyGatewayPaymentOutcome).not.toHaveBeenCalled();
    });

    it('accepts a correctly-signed charge.success event and applies a SUCCEEDED outcome', async () => {
      const { paystack } = await import('../../src/controllers/webhooks/payment.controller.js');

      const payload = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_abc' } }));
      const signature = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(payload).digest('hex');
      verifyPaystackTransaction.mockResolvedValue({
        status: 'success',
        reference: 'ref_abc',
        amountMinor: 75_000,
        currency: 'NGN',
      });

      const req = mockReq({ 'x-paystack-signature': signature }, payload);
      const res = mockRes();

      await paystack(req, asResponse(res));

      expect(res.status).toHaveBeenCalledWith(202);
      expect(applyGatewayPaymentOutcome).toHaveBeenCalledWith({
        providerReference: 'ref_abc',
        outcome: 'SUCCEEDED',
        gatewayReported: { amountMinor: 75_000, currency: 'NGN' },
      });
      expect(verifyPaystackTransaction).toHaveBeenCalledWith('ref_abc');
    });

    function signedPaystack(body: unknown) {
      const payload = Buffer.from(JSON.stringify(body));
      const signature = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(payload).digest('hex');
      return mockReq({ 'x-paystack-signature': signature }, payload);
    }

    it('does not settle when Paystack verify reports a non-success status', async () => {
      const { paystack } = await import('../../src/controllers/webhooks/payment.controller.js');
      verifyPaystackTransaction.mockResolvedValue({
        status: 'abandoned',
        reference: 'ref_1',
        amountMinor: 100,
        currency: 'NGN',
      });
      const res = mockRes();

      await paystack(signedPaystack({ event: 'charge.success', data: { reference: 'ref_1' } }), asResponse(res));

      expect(res.status).toHaveBeenCalledWith(202);
      expect(applyGatewayPaymentOutcome).not.toHaveBeenCalled();
    });

    it('answers 503 (so Paystack retries) and does not settle when the verify call fails', async () => {
      const { paystack } = await import('../../src/controllers/webhooks/payment.controller.js');
      verifyPaystackTransaction.mockRejectedValue(new Error('timeout'));
      const res = mockRes();

      await paystack(signedPaystack({ event: 'charge.success', data: { reference: 'ref_1' } }), asResponse(res));

      expect(res.status).toHaveBeenCalledWith(503);
      expect(applyGatewayPaymentOutcome).not.toHaveBeenCalled();
    });

    it('returns 400 for a validly-signed body that is not JSON', async () => {
      const { paystack } = await import('../../src/controllers/webhooks/payment.controller.js');
      const payload = Buffer.from('not json{');
      const signature = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(payload).digest('hex');
      const res = mockRes();

      await paystack(mockReq({ 'x-paystack-signature': signature }, payload), asResponse(res));

      expect(res.status).toHaveBeenCalledWith(400);
      expect(applyGatewayPaymentOutcome).not.toHaveBeenCalled();
    });

    it('applies a FAILED outcome for a charge.failed event', async () => {
      const { paystack } = await import('../../src/controllers/webhooks/payment.controller.js');

      const payload = Buffer.from(JSON.stringify({ event: 'charge.failed', data: { reference: 'ref_xyz' } }));
      const signature = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(payload).digest('hex');

      const req = mockReq({ 'x-paystack-signature': signature }, payload);
      const res = mockRes();

      await paystack(req, asResponse(res));

      expect(applyGatewayPaymentOutcome).toHaveBeenCalledWith({
        providerReference: 'ref_xyz',
        outcome: 'FAILED',
      });
    });
  });

  describe('Flutterwave', () => {
    it('rejects a webhook whose verif-hash does not match the configured secret', async () => {
      const { flutterwave } = await import('../../src/controllers/webhooks/payment.controller.js');

      const payload = Buffer.from(
        JSON.stringify({ event: 'charge.completed', data: { tx_ref: 'wyl_fw_1', status: 'successful' } }),
      );

      const req = mockReq({ 'verif-hash': 'not-the-secret' }, payload);
      const res = mockRes();

      await flutterwave(req, asResponse(res));

      expect(res.status).toHaveBeenCalledWith(400);
      expect(applyGatewayPaymentOutcome).not.toHaveBeenCalled();
    });

    it('accepts a correctly-hashed successful charge and applies a SUCCEEDED outcome', async () => {
      const { flutterwave } = await import('../../src/controllers/webhooks/payment.controller.js');

      verifyFlutterwaveTransaction.mockResolvedValue({
        status: 'successful',
        txRef: 'wyl_fw_1',
        amountMinor: 5_000,
        currency: 'UGX',
      });
      const payload = Buffer.from(
        JSON.stringify({ event: 'charge.completed', data: { id: 99, tx_ref: 'wyl_fw_1', status: 'successful' } }),
      );

      const req = mockReq({ 'verif-hash': FLUTTERWAVE_SECRET_KEY }, payload);
      const res = mockRes();

      await flutterwave(req, asResponse(res));

      expect(res.status).toHaveBeenCalledWith(202);
      expect(applyGatewayPaymentOutcome).toHaveBeenCalledWith({
        providerReference: 'wyl_fw_1',
        outcome: 'SUCCEEDED',
        gatewayReported: { amountMinor: 5_000, currency: 'UGX' },
      });
      expect(verifyFlutterwaveTransaction).toHaveBeenCalledWith(99);
    });

    it('answers 503 and does not settle when Flutterwave verify fails', async () => {
      const { flutterwave } = await import('../../src/controllers/webhooks/payment.controller.js');
      verifyFlutterwaveTransaction.mockRejectedValue(new Error('boom'));
      const payload = Buffer.from(
        JSON.stringify({ event: 'charge.completed', data: { id: 1, tx_ref: 'wyl_fw_3', status: 'successful' } }),
      );
      const res = mockRes();

      await flutterwave(mockReq({ 'verif-hash': FLUTTERWAVE_SECRET_KEY }, payload), asResponse(res));

      expect(res.status).toHaveBeenCalledWith(503);
      expect(applyGatewayPaymentOutcome).not.toHaveBeenCalled();
    });

    it('does not settle when verify says the tx_ref differs from the webhook', async () => {
      const { flutterwave } = await import('../../src/controllers/webhooks/payment.controller.js');
      verifyFlutterwaveTransaction.mockResolvedValue({
        status: 'successful',
        txRef: 'someone_elses',
        amountMinor: 1,
        currency: 'GHS',
      });
      const payload = Buffer.from(
        JSON.stringify({ event: 'charge.completed', data: { id: 1, tx_ref: 'wyl_fw_3', status: 'successful' } }),
      );
      const res = mockRes();

      await flutterwave(mockReq({ 'verif-hash': FLUTTERWAVE_SECRET_KEY }, payload), asResponse(res));

      expect(applyGatewayPaymentOutcome).not.toHaveBeenCalled();
    });

    it('returns 400 for a correctly-hashed body that is not JSON', async () => {
      const { flutterwave } = await import('../../src/controllers/webhooks/payment.controller.js');
      const res = mockRes();

      await flutterwave(mockReq({ 'verif-hash': FLUTTERWAVE_SECRET_KEY }, Buffer.from('{oops')), asResponse(res));

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('applies a FAILED outcome for a failed charge', async () => {
      const { flutterwave } = await import('../../src/controllers/webhooks/payment.controller.js');

      const payload = Buffer.from(
        JSON.stringify({ event: 'charge.completed', data: { tx_ref: 'wyl_fw_2', status: 'failed' } }),
      );

      const req = mockReq({ 'verif-hash': FLUTTERWAVE_SECRET_KEY }, payload);
      const res = mockRes();

      await flutterwave(req, asResponse(res));

      expect(applyGatewayPaymentOutcome).toHaveBeenCalledWith({
        providerReference: 'wyl_fw_2',
        outcome: 'FAILED',
      });
    });
  });
});
