/**
 * Human-readable references used in correspondence with students and
 * institutions (PRD §2.6 — standardised, verifiable paperwork).
 */
import { customAlphabet } from 'nanoid';

// Ambiguous characters (0/O, 1/I) omitted so references survive being read
// aloud on a call or retyped from a printed letter.
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

/** WYL-STU-XXXXXX */
export function studentReference(): string {
  return `WYL-STU-${nanoid()}`;
}

/** WYL-APP-XXXXXX */
export function applicationReference(): string {
  return `WYL-APP-${nanoid()}`;
}

/** WYL-APT-XXXXXX */
export function appointmentReference(): string {
  return `WYL-APT-${nanoid()}`;
}

/**
 * Sequential, gap-free invoice numbers: INV-2026-00042. Accounting reviews
 * expect no gaps, so the caller must derive `sequence` inside the same
 * transaction that inserts the invoice.
 */
export function invoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(5, '0')}`;
}
