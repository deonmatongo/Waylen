/**
 * Flutterwave Standard Payments (PRD §8.1, phase 3).
 *
 * Like Paystack, there is no actively maintained official Node SDK worth
 * taking a dependency on — their REST API is the integration path Flutterwave
 * itself documents, so this is a thin typed `fetch` wrapper rather than a
 * forced SDK.
 */
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { ServiceUnavailableError } from '../../utils/errors.js';
import { majorToMinor, minorToMajor } from './currency.js';
import type { CheckoutSession, CheckoutSessionInput, RefundInput, RefundResult } from './types.js';

const FLUTTERWAVE_BASE = 'https://api.flutterwave.com/v3';
const FETCH_TIMEOUT_MS = 10_000;

interface FlutterwaveInitializeResponse {
  status: string;
  message: string;
  data?: { link: string };
}

/** Returns null when `FLUTTERWAVE_SECRET_KEY` is not configured — caller falls back. */
export async function createFlutterwaveCheckoutSession(
  input: CheckoutSessionInput,
): Promise<CheckoutSession | null> {
  if (!env.FLUTTERWAVE_SECRET_KEY) return null;

  // Our own reference (`tx_ref`), generated up front so it can be stored on
  // the Payment row before the gateway call returns.
  const txRef = `wyl_fw_${crypto.randomUUID()}`;

  const response = await fetch(`${FLUTTERWAVE_BASE}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.FLUTTERWAVE_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tx_ref: txRef,
      // Flutterwave expects a decimal major-unit amount ("10.00"), unlike our
      // integer minor-unit storage — convert back down here (zero-decimal
      // currencies such as UGX/RWF/XAF/XOF are sent as-is).
      amount: minorToMajor(input.amountMinor, input.currency),
      currency: input.currency,
      redirect_url: `${env.APP_URL}/portal/invoices/${input.invoiceId}?payment=return`,
      customer: { email: input.studentEmail, name: input.studentName },
      customizations: {
        title: `Invoice ${input.invoiceNumber}`,
        description: `Waylen invoice ${input.invoiceNumber}`,
      },
      meta: { invoiceId: input.invoiceId, invoiceNumber: input.invoiceNumber },
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ServiceUnavailableError(
      `Flutterwave checkout initialization failed (${response.status}): ${detail}`,
    );
  }

  const json = (await response.json()) as FlutterwaveInitializeResponse;
  if (json.status !== 'success' || !json.data?.link) {
    throw new ServiceUnavailableError('Flutterwave did not return a checkout URL.');
  }

  return {
    provider: 'flutterwave',
    method: 'FLUTTERWAVE',
    providerReference: txRef,
    checkoutUrl: json.data.link,
  };
}

export interface VerifiedFlutterwaveTransaction {
  status: string;
  txRef: string;
  amountMinor: number;
  currency: string;
}

/**
 * Server-side confirmation of a transaction (GET /v3/transactions/:id/verify).
 * The webhook body is only a hint — this is what proves the money moved.
 * Throws `ServiceUnavailableError` on any transport/API failure so the caller
 * can answer non-2xx and let Flutterwave retry.
 */
export async function verifyFlutterwaveTransaction(
  transactionId: string | number,
): Promise<VerifiedFlutterwaveTransaction> {
  if (!env.FLUTTERWAVE_SECRET_KEY) {
    throw new ServiceUnavailableError('Flutterwave is not configured.');
  }

  let json: {
    status?: string;
    data?: { status?: string; tx_ref?: string; amount?: number; currency?: string };
  };
  try {
    const response = await fetch(
      `${FLUTTERWAVE_BASE}/transactions/${encodeURIComponent(String(transactionId))}/verify`,
      {
        headers: { Authorization: `Bearer ${env.FLUTTERWAVE_SECRET_KEY}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new ServiceUnavailableError(`Flutterwave verification failed (${response.status}).`);
    }
    json = (await response.json()) as typeof json;
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    throw new ServiceUnavailableError('Flutterwave verification request failed.');
  }

  const data = json.data;
  if (
    json.status !== 'success' ||
    !data ||
    typeof data.amount !== 'number' ||
    typeof data.currency !== 'string' ||
    typeof data.tx_ref !== 'string'
  ) {
    throw new ServiceUnavailableError('Flutterwave returned an unusable verification response.');
  }

  return {
    status: data.status ?? '',
    txRef: data.tx_ref,
    amountMinor: majorToMinor(data.amount, data.currency),
    currency: data.currency,
  };
}

/**
 * Refunds a transaction (POST /v3/transactions/:id/refund). Refunds are keyed
 * on Flutterwave's numeric transaction id, not our `tx_ref`, so the id is
 * resolved first via verify_by_reference. The amount goes out in major units.
 */
export async function refundFlutterwavePayment(input: RefundInput): Promise<RefundResult> {
  if (!env.FLUTTERWAVE_SECRET_KEY) throw new ServiceUnavailableError('Flutterwave is not configured.');
  const headers = {
    Authorization: `Bearer ${env.FLUTTERWAVE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };

  let refundJson: { status?: string; message?: string; data?: { id?: number | string } };
  try {
    const lookup = await fetch(
      `${FLUTTERWAVE_BASE}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(input.providerReference)}`,
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!lookup.ok) {
      throw new ServiceUnavailableError(`Flutterwave transaction lookup failed (${lookup.status}).`);
    }
    const found = (await lookup.json()) as { status?: string; data?: { id?: number } };
    if (found.status !== 'success' || typeof found.data?.id !== 'number') {
      throw new ServiceUnavailableError('Flutterwave has no transaction for that reference.');
    }

    const response = await fetch(`${FLUTTERWAVE_BASE}/transactions/${found.data.id}/refund`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: minorToMajor(input.amountMinor, input.currency) }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ServiceUnavailableError(`Flutterwave refund failed (${response.status}).`);
    }
    refundJson = (await response.json()) as typeof refundJson;
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    throw new ServiceUnavailableError('Flutterwave refund request failed.');
  }

  if (refundJson.status !== 'success') {
    throw new ServiceUnavailableError(
      `Flutterwave refused the refund: ${refundJson.message ?? 'unknown reason'}.`,
    );
  }
  return {
    refundReference: refundJson.data?.id !== undefined ? String(refundJson.data.id) : undefined,
  };
}
