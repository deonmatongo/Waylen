/**
 * Shared types for the online card payment gateways (PRD §8.1, phase 3).
 */
import type { PaymentMethod } from '@prisma/client';

export type GatewayProvider = 'stripe' | 'paystack' | 'flutterwave';

export interface CheckoutSessionInput {
  invoiceId: string;
  invoiceNumber: string;
  /** Outstanding balance to charge, in minor units (cents). */
  amountMinor: number;
  currency: string;
  studentEmail: string;
  studentName: string;
}

export interface CheckoutSession {
  provider: GatewayProvider;
  method: PaymentMethod;
  /** Stored on `Payment.providerReference` — matched back to this row by the webhook. */
  providerReference: string;
  /** The gateway's hosted checkout page the student is redirected to. */
  checkoutUrl: string;
}
