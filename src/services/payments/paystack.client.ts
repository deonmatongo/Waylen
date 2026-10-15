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
import type { CheckoutSession, CheckoutSessionInput, RefundInput, RefundResult } from './types.js';

const PAYSTACK_BASE = 'https://api.paystack.co';
const FETCH_TIMEOUT_MS = 10_000;

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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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

export interface VerifiedPaystackTransaction {
  status: string;
  reference: string;
  amountMinor: number;
  currency: string;
}

/**
 * Server-side confirmation of a transaction (GET /transaction/verify/:reference).
 * Throws `ServiceUnavailableError` on any transport/API failure so the caller
 * can answer non-2xx and let Paystack retry.
 */
export async function verifyPaystackTransaction(
  reference: string,
): Promise<VerifiedPaystackTransaction> {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new ServiceUnavailableError('Paystack is not configured.');
  }

  let json: {
    status?: boolean;
    data?: { status?: string; reference?: string; amount?: number; currency?: string };
  };
  try {
    const response = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ServiceUnavailableError(`Paystack verification failed (${response.status}).`);
    }
    json = (await response.json()) as typeof json;
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    throw new ServiceUnavailableError('Paystack verification request failed.');
  }

  const data = json.data;
  if (
    !json.status ||
    !data ||
    typeof data.amount !== 'number' ||
    typeof data.currency !== 'string' ||
    typeof data.reference !== 'string'
  ) {
    throw new ServiceUnavailableError('Paystack returned an unusable verification response.');
  }

  return {
    status: data.status ?? '',
    reference: data.reference,
    amountMinor: data.amount,
    currency: data.currency,
  };
}

/**
 * Refunds a transaction (POST /refund). `transaction` accepts the reference
 * we generated at checkout; `amount` is in the same minor units we store.
 */
export async function refundPaystackPayment(input: RefundInput): Promise<RefundResult> {
  if (!env.PAYSTACK_SECRET_KEY) throw new ServiceUnavailableError('Paystack is not configured.');

  let json: { status?: boolean; message?: string; data?: { id?: number | string } };
  try {
    const response = await fetch(`${PAYSTACK_BASE}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transaction: input.providerReference,
        amount: input.amountMinor,
        currency: input.currency,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ServiceUnavailableError(`Paystack refund failed (${response.status}).`);
    }
    json = (await response.json()) as typeof json;
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    throw new ServiceUnavailableError('Paystack refund request failed.');
  }

  if (!json.status) {
    throw new ServiceUnavailableError(`Paystack refused the refund: ${json.message ?? 'unknown reason'}.`);
  }
  return { refundReference: json.data?.id !== undefined ? String(json.data.id) : undefined };
}
