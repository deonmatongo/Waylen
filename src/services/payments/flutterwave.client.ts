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
import type { CheckoutSession, CheckoutSessionInput } from './types.js';

const FLUTTERWAVE_BASE = 'https://api.flutterwave.com/v3';

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
      // integer minor-unit storage — convert back down here. This assumes a
      // 2-decimal currency, true for every currency Waylen currently invoices
      // in (EUR/USD/GBP/NGN/GHS/KES/...).
      amount: (input.amountMinor / 100).toFixed(2),
      currency: input.currency,
      redirect_url: `${env.APP_URL}/portal/invoices/${input.invoiceId}?payment=return`,
      customer: { email: input.studentEmail, name: input.studentName },
      customizations: {
        title: `Invoice ${input.invoiceNumber}`,
        description: `Waylen invoice ${input.invoiceNumber}`,
      },
      meta: { invoiceId: input.invoiceId, invoiceNumber: input.invoiceNumber },
    }),
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
