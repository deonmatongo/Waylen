/**
 * Payment gateway webhooks (PRD §8.1).
 *
 * Every handler verifies the provider signature over the RAW body before
 * trusting a single field. An unverified webhook is rejected outright — it is
 * an unauthenticated request claiming money has moved.
 */
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { safeCompare } from '../../utils/crypto.js';

/**
 * TODO(phase-2): once a processor is chosen, complete the handler bodies:
 *   1. verify the signature (already sketched below);
 *   2. look the payment up by `providerReference` — webhooks are delivered
 *      more than once, so handling must be idempotent;
 *   3. update Payment + Invoice inside one transaction;
 *   4. notify the student via notificationService.
 */

export async function stripe(req: Request, res: Response): Promise<void> {
  const signature = req.get('stripe-signature');

  if (!env.STRIPE_WEBHOOK_SECRET || !signature) {
    logger.warn('Stripe webhook received without a configured secret or signature');
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }

  // Stripe signs "{timestamp}.{payload}" with HMAC-SHA256.
  // TODO(phase-2): parse the t= and v1= parts of the header, reject timestamps
  // outside a 5-minute tolerance, then compare.
  logger.info('Stripe webhook received (handler not implemented)');
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

  logger.info('Paystack webhook verified (handler not implemented)');
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

  logger.info('Flutterwave webhook verified (handler not implemented)');
  res.status(202).json({ received: true });
}
