/**
 * Payment gateway webhooks (PRD §8.1).
 *
 * Mounted before the session and CSRF middleware: these callers are
 * authenticated by provider signature, not by cookie. The raw body is required
 * for signature verification, so `express.raw` is applied per-route rather
 * than relying on the app-level JSON parser.
 */
import { Router, raw } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as paymentWebhookController from '../controllers/webhooks/payment.controller.js';

export const webhookRouter = Router();

webhookRouter.post(
  '/stripe',
  raw({ type: 'application/json' }),
  asyncHandler(paymentWebhookController.stripe),
);

webhookRouter.post(
  '/paystack',
  raw({ type: 'application/json' }),
  asyncHandler(paymentWebhookController.paystack),
);

webhookRouter.post(
  '/flutterwave',
  raw({ type: 'application/json' }),
  asyncHandler(paymentWebhookController.flutterwave),
);
