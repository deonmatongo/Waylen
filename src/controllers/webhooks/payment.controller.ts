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
      await billingService.applyGatewayPaymentOutcome({
        providerReference: session.id,
        outcome: 'SUCCEEDED',
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

  const event = JSON.parse((req.body as Buffer).toString('utf8')) as {
    event: string;
    data: { reference: string };
  };

  if (event.event === 'charge.success') {
    await billingService.applyGatewayPaymentOutcome({
      providerReference: event.data.reference,
      outcome: 'SUCCEEDED',
    });
  } else if (event.event === 'charge.failed') {
    await billingService.applyGatewayPaymentOutcome({
      providerReference: event.data.reference,
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

  const event = JSON.parse((req.body as Buffer).toString('utf8')) as {
    event: string;
    data?: { tx_ref: string; status: string };
  };

  if (event.data?.status === 'successful') {
    await billingService.applyGatewayPaymentOutcome({
      providerReference: event.data.tx_ref,
      outcome: 'SUCCEEDED',
    });
  } else if (event.data?.status === 'failed') {
    await billingService.applyGatewayPaymentOutcome({
      providerReference: event.data.tx_ref,
      outcome: 'FAILED',
    });
  } else {
    logger.info({ status: event.data?.status }, 'Flutterwave webhook event ignored');
  }

  res.status(202).json({ received: true });
}
