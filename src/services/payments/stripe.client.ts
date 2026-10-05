/**
 * Stripe Checkout (PRD §8.1, phase 3).
 *
 * A Checkout Session is the hosted-page integration: Stripe collects the
 * card (and Apple Pay/Google Pay, enabled automatically for an eligible
 * browser) and redirects back, with the session id as our correlation key.
 */
import Stripe from 'stripe';
import { env } from '../../config/env.js';
import { ServiceUnavailableError } from '../../utils/errors.js';
import type { CheckoutSession, CheckoutSessionInput } from './types.js';

let client: Stripe | null = null;

function getClient(secretKey: string): Stripe {
  client ??= new Stripe(secretKey);
  return client;
}

/** Returns null when `STRIPE_SECRET_KEY` is not configured — caller falls back. */
export async function createStripeCheckoutSession(
  input: CheckoutSessionInput,
): Promise<CheckoutSession | null> {
  if (!env.STRIPE_SECRET_KEY) return null;

  const stripeClient = getClient(env.STRIPE_SECRET_KEY);

  const session = await stripeClient.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: input.currency.toLowerCase(),
          product_data: { name: `Invoice ${input.invoiceNumber}` },
          unit_amount: input.amountMinor,
        },
        quantity: 1,
      },
    ],
    customer_email: input.studentEmail,
    success_url: `${env.APP_URL}/portal/invoices/${input.invoiceId}?payment=success`,
    cancel_url: `${env.APP_URL}/portal/invoices/${input.invoiceId}?payment=cancelled`,
    metadata: { invoiceId: input.invoiceId, invoiceNumber: input.invoiceNumber },
  });

  if (!session.url) {
    throw new ServiceUnavailableError('Stripe did not return a checkout URL.');
  }

  return {
    provider: 'stripe',
    method: 'CARD',
    providerReference: session.id,
    checkoutUrl: session.url,
  };
}
