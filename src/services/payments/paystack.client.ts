/**
 * Paystack Transaction Initialize (PRD §8.1, phase 3).
 *
 * No maintained first-party Paystack npm SDK exists for Node — their own docs
 * point integrators at the plain REST API, which is a handful of JSON calls.
 * A thin typed `fetch` wrapper is simpler and has fewer moving parts than
 * pulling in a third-party wrapper package for this.
 */
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { ServiceUnavailableError } from '../../utils/errors.js';
import type { CheckoutSession, CheckoutSessionInput } from './types.js';

const PAYSTACK_BASE = 'https://api.paystack.co';

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

/** Returns null when `PAYSTACK_SECRET_KEY` is not configured — caller falls back. */
export async function createPaystackCheckoutSession(
  input: CheckoutSessionInput,
): Promise<CheckoutSession | null> {
  if (!env.PAYSTACK_SECRET_KEY) return null;

  // Our own reference, not Paystack's — generated up front so it can be
  // stored on the Payment row before the gateway call even returns.
  const reference = `wyl_ps_${crypto.randomUUID()}`;

  const response = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: input.studentEmail,
      // Paystack's `amount` is already in the smallest currency unit (kobo
      // for NGN) — the same minor-unit convention this platform stores
      // money in, so no conversion is needed.
      amount: input.amountMinor,
      currency: input.currency,
      reference,
      callback_url: `${env.APP_URL}/portal/invoices/${input.invoiceId}?payment=return`,
      metadata: { invoiceId: input.invoiceId, invoiceNumber: input.invoiceNumber },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ServiceUnavailableError(
      `Paystack checkout initialization failed (${response.status}): ${detail}`,
    );
  }

  const json = (await response.json()) as PaystackInitializeResponse;
  if (!json.status || !json.data?.authorization_url) {
    throw new ServiceUnavailableError('Paystack did not return a checkout URL.');
  }

  return {
    provider: 'paystack',
    method: 'PAYSTACK',
    providerReference: json.data.reference,
    checkoutUrl: json.data.authorization_url,
  };
}
