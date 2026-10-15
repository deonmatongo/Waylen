/**
 * Payment gateway webhooks (PRD §8.1).
 *
 * Every handler verifies the provider signature over the RAW body before
 * trusting a single field. An unverified webhook is rejected outright — it is
 * an unauthenticated request claiming money has moved.
 *
 * Once verified, each handler looks the Payment up by `providerReference` and
 * hands off to `billingService.applyGatewayPaymentOutcome`, which is
 * idempotent — see `src/services/payments/ledger.ts` — so a redelivered
 * webhook (every one of these providers retries on anything but a 2xx) never
 * double-applies.
 */
import crypto from 'node:crypto';
import Stripe from 'stripe';
import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { safeCompare } from '../../utils/crypto.js';
import { billingService } from '../../services/billing.service.js';
import { verifyPaystackTransaction } from '../../services/payments/paystack.client.js';
import { verifyFlutterwaveTransaction } from '../../services/payments/flutterwave.client.js';

export async function stripe(req: Request, res: Response): Promise<void> {
  const signature = req.get('stripe-signature');

  if (!env.STRIPE_WEBHOOK_SECRET || !signature) {
    logger.warn('Stripe webhook received without a configured secret or signature');
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }

  // Stripe signs "{timestamp}.{payload}" with HMAC-SHA256 and rejects
  // timestamps outside a tolerance window itself; `constructEvent` does both
  // the parsing of the `t=`/`v1=` header and the comparison.
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(req.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'Stripe webhook signature verification failed');
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      // `completed` fires when the Checkout finishes, not when the money
      // lands — a delayed method (bank debit) is still 'unpaid' and settles
      // later via `async_payment_succeeded`, which is itself the paid signal.
      if (event.type === 'checkout.session.completed' && session.payment_status !== 'paid') {
        logger.info(
          { sessionId: session.id, paymentStatus: session.payment_status },
          'Stripe checkout completed but not yet paid — awaiting async payment event',
        );
        break;
      }
      await billingService.applyGatewayPaymentOutcome({
        providerReference: session.id,
        outcome: 'SUCCEEDED',
        // Stripe amounts/currency are already minor units / lowercase ISO.
        gatewayReported: {
          amountMinor: session.amount_total ?? Number.NaN,
          currency: session.currency ?? '',
        },
      });
      break;
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object;
      await billingService.applyGatewayPaymentOutcome({
        providerReference: session.id,
        outcome: 'FAILED',
      });
      break;
    }
    default:
      logger.info({ type: event.type }, 'Stripe webhook event ignored');
  }

  res.status(202).json({ received: true });
}

export async function paystack(req: Request, res: Response): Promise<void> {
  const signature = req.get('x-paystack-signature');

  if (!env.PAYSTACK_SECRET_KEY || !signature) {
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }

  const expected = crypto
    .createHmac('sha512', env.PAYSTACK_SECRET_KEY)
    .update(req.body as Buffer)
    .digest('hex');

  if (!safeCompare(signature, expected)) {
    logger.warn('Paystack webhook signature mismatch');
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }

  let event: { event: string; data?: { reference?: string } };
  try {
    event = JSON.parse((req.body as Buffer).toString('utf8')) as typeof event;
  } catch {
    logger.warn('Paystack webhook body is not valid JSON');
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const reference = event.data?.reference;
  if (!reference) {
    logger.warn({ type: event.event }, 'Paystack webhook without a reference ignored');
    res.status(202).json({ received: true });
    return;
  }

  if (event.event === 'charge.success') {
    // The signed body is a claim, not proof — confirm with Paystack directly.
    let verified;
    try {
      verified = await verifyPaystackTransaction(reference);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : err, reference }, 'Paystack verify failed');
      // Non-2xx so Paystack redelivers once its API is reachable again.
      res.status(503).json({ error: 'Verification unavailable' });
      return;
    }
    if (verified.status !== 'success' || verified.reference !== reference) {
      logger.warn({ reference, status: verified.status }, 'Paystack verify did not confirm success — not settling');
      res.status(202).json({ received: true });
      return;
    }
    await billingService.applyGatewayPaymentOutcome({
      providerReference: reference,
      outcome: 'SUCCEEDED',
      gatewayReported: { amountMinor: verified.amountMinor, currency: verified.currency },
    });
  } else if (event.event === 'charge.failed') {
    await billingService.applyGatewayPaymentOutcome({
      providerReference: reference,
      outcome: 'FAILED',
    });
  } else {
    logger.info({ type: event.event }, 'Paystack webhook event ignored');
  }

  res.status(202).json({ received: true });
}

export async function flutterwave(req: Request, res: Response): Promise<void> {
  const signature = req.get('verif-hash');

  if (!env.FLUTTERWAVE_SECRET_KEY || !signature) {
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }

  if (!safeCompare(signature, env.FLUTTERWAVE_SECRET_KEY)) {
    logger.warn('Flutterwave webhook hash mismatch');
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }

  let event: { event: string; data?: { id?: number | string; tx_ref?: string; status?: string } };
  try {
    event = JSON.parse((req.body as Buffer).toString('utf8')) as typeof event;
  } catch {
    logger.warn('Flutterwave webhook body is not valid JSON');
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const txRef = event.data?.tx_ref;
  if (event.data?.status === 'successful' && txRef) {
    // The hash only proves who sent it — confirm the charge with Flutterwave.
    let verified;
    try {
      if (event.data.id === undefined) throw new Error('Webhook carried no transaction id');
      verified = await verifyFlutterwaveTransaction(event.data.id);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : err, txRef }, 'Flutterwave verify failed');
      res.status(503).json({ error: 'Verification unavailable' });
      return;
    }
    if (verified.status !== 'successful' || verified.txRef !== txRef) {
      logger.warn({ txRef, status: verified.status }, 'Flutterwave verify did not confirm success — not settling');
      res.status(202).json({ received: true });
      return;
    }
    await billingService.applyGatewayPaymentOutcome({
      providerReference: txRef,
      outcome: 'SUCCEEDED',
      gatewayReported: { amountMinor: verified.amountMinor, currency: verified.currency },
    });
  } else if (event.data?.status === 'failed' && txRef) {
    await billingService.applyGatewayPaymentOutcome({
      providerReference: txRef,
      outcome: 'FAILED',
    });
  } else {
    logger.info({ status: event.data?.status }, 'Flutterwave webhook event ignored');
  }

  res.status(202).json({ received: true });
}
