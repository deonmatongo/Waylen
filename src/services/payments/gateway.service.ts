/**
 * Online card payment gateways — orchestration (PRD §8.1, phase 3).
 *
 * Three sandbox-mode processors, chosen by the invoice's currency rather
 * than a student-facing picker:
 *   - Stripe:      default/fallback. Strongest coverage for EUR/USD/GBP and
 *                  other major currencies, which is what most Waylen invoices
 *                  are issued in, and the only one of the three with native
 *                  Apple Pay/Google Pay on the hosted page (PRD §8.1).
 *   - Paystack:    NGN invoices. Paystack is a Nigeria-specific processor
 *                  with materially better NGN settlement/success rates than
 *                  a pan-African gateway, so Nigerian-currency invoices route
 *                  here specifically rather than through Flutterwave.
 *   - Flutterwave: every other African currency Waylen invoices in (GHS,
 *                  KES, UGX, TZS, ZAR, XAF, XOF, RWF, ZMW, ...) — its pan-
 *                  African reach is the reason to prefer it over Stripe for
 *                  these.
 *
 * Currency is a reasonable proxy for "which gateway" without adding a
 * selection step to checkout (the PRD does not call for a picker), and it
 * keeps `startPayment()` a single deterministic call rather than a form.
 *
 * Each gateway is independently optional. If the secret key implied by the
 * invoice's currency is not configured, `createCheckoutSession` returns
 * `null` for that invoice and the caller falls back to the existing
 * "online card payment is not switched on yet" messaging — it never
 * crashes, and it never silently substitutes a different gateway than the
 * one the currency implies.
 */
import { ValidationError } from '../../utils/errors.js';
import type {
  CheckoutSession,
  CheckoutSessionInput,
  GatewayProvider,
  RefundInput,
  RefundResult,
} from './types.js';
import { createStripeCheckoutSession, refundStripePayment } from './stripe.client.js';
import { createPaystackCheckoutSession, refundPaystackPayment } from './paystack.client.js';
import { createFlutterwaveCheckoutSession, refundFlutterwavePayment } from './flutterwave.client.js';

const FLUTTERWAVE_CURRENCIES = new Set([
  'GHS',
  'KES',
  'UGX',
  'TZS',
  'ZAR',
  'XAF',
  'XOF',
  'RWF',
  'ZMW',
]);

export function selectGateway(currency: string): GatewayProvider {
  const code = currency.toUpperCase();
  if (code === 'NGN') return 'paystack';
  if (FLUTTERWAVE_CURRENCIES.has(code)) return 'flutterwave';
  return 'stripe';
}

export async function createCheckoutSession(
  input: CheckoutSessionInput,
): Promise<CheckoutSession | null> {
  const provider = selectGateway(input.currency);

  if (provider === 'paystack') return createPaystackCheckoutSession(input);
  if (provider === 'flutterwave') return createFlutterwaveCheckoutSession(input);
  return createStripeCheckoutSession(input);
}

/** Routes a refund to the gateway that took the payment (`Payment.provider`). */
export async function refundGatewayPayment(
  input: RefundInput & { provider: string },
): Promise<RefundResult> {
  if (input.provider === 'stripe') return refundStripePayment(input);
  if (input.provider === 'paystack') return refundPaystackPayment(input);
  if (input.provider === 'flutterwave') return refundFlutterwavePayment(input);
  throw new ValidationError(`Refunds are not supported for provider "${input.provider}".`);
}
