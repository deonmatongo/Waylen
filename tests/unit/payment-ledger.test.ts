/**
 * Pure webhook ledger logic (PRD §8.1, phase 2) — no DB, no gateway network
 * calls. This is the idempotency/settlement decision every gateway webhook
 * handler defers to.
 */
import { describe, it, expect } from 'vitest';
import { computeGatewayLedgerUpdate } from '../../src/services/payments/ledger.js';

describe('computeGatewayLedgerUpdate', () => {
  it('settles the invoice in full when the gateway payment covers the whole outstanding balance', () => {
    const result = computeGatewayLedgerUpdate(
      { status: 'PENDING', amountMinor: 50_000 },
      { totalMinor: 50_000, paidMinor: 0 },
      'SUCCEEDED',
    );

    expect(result).toEqual({
      apply: true,
      paymentStatus: 'SUCCEEDED',
      invoice: { paidMinor: 50_000, status: 'PAID', settled: true },
    });
  });

  it('leaves the invoice partially paid when the gateway payment does not cover the full balance', () => {
    const result = computeGatewayLedgerUpdate(
      { status: 'PENDING', amountMinor: 20_000 },
      { totalMinor: 50_000, paidMinor: 10_000 },
      'SUCCEEDED',
    );

    expect(result).toEqual({
      apply: true,
      paymentStatus: 'SUCCEEDED',
      invoice: { paidMinor: 30_000, status: 'PARTIALLY_PAID', settled: false },
    });
  });

  it('marks the payment FAILED without touching the invoice balance', () => {
    const result = computeGatewayLedgerUpdate(
      { status: 'PENDING', amountMinor: 50_000 },
      { totalMinor: 50_000, paidMinor: 0 },
      'FAILED',
    );

    expect(result).toEqual({ apply: true, paymentStatus: 'FAILED' });
    expect(result.invoice).toBeUndefined();
  });

  it('ignores a replayed webhook once the payment has already succeeded (idempotency)', () => {
    const result = computeGatewayLedgerUpdate(
      { status: 'SUCCEEDED', amountMinor: 50_000 },
      { totalMinor: 50_000, paidMinor: 50_000 },
      'SUCCEEDED',
    );

    expect(result).toEqual({ apply: false, paymentStatus: 'SUCCEEDED' });
  });

  it('ignores a replayed webhook once the payment has already failed, even if it now claims success', () => {
    // Gateways are not guaranteed to deliver events in order — a late
    // "actually it succeeded" must not reopen a payment already settled as
    // FAILED.
    const result = computeGatewayLedgerUpdate(
      { status: 'FAILED', amountMinor: 50_000 },
      { totalMinor: 50_000, paidMinor: 0 },
      'SUCCEEDED',
    );

    expect(result).toEqual({ apply: false, paymentStatus: 'FAILED' });
  });

  it('ignores a webhook for a payment that was manually reconciled in the meantime', () => {
    const result = computeGatewayLedgerUpdate(
      { status: 'REFUNDED', amountMinor: 50_000 },
      { totalMinor: 50_000, paidMinor: 0 },
      'SUCCEEDED',
    );

    expect(result.apply).toBe(false);
  });

  it('clamps an overpay to the invoice total rather than recording an impossible balance', () => {
    // e.g. a manual (bank-transfer) payment landed concurrently with the
    // gateway payment, so paidMinor + amountMinor would exceed totalMinor.
    const result = computeGatewayLedgerUpdate(
      { status: 'PENDING', amountMinor: 50_000 },
      { totalMinor: 50_000, paidMinor: 10_000 },
      'SUCCEEDED',
    );

    expect(result.invoice?.paidMinor).toBe(50_000);
    expect(result.invoice?.status).toBe('PAID');
    expect(result.invoice?.settled).toBe(true);
  });
});
