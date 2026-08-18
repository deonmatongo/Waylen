/**
 * Invoicing & payments validation (PRD §5.2, §5.4, §8.1).
 */
import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';

/** Methods a student can claim to have paid by when submitting proof by hand. */
const MANUAL_PAYMENT_METHODS: PaymentMethod[] = ['BANK_TRANSFER', 'SWIFT', 'REVOLUT', 'CASH'];

const manualMethod = z
  .nativeEnum(PaymentMethod)
  .refine((method) => MANUAL_PAYMENT_METHODS.includes(method), {
    message: 'Choose how you paid',
  });

export const submitProofOfPaymentSchema = z.object({
  method: manualMethod,
  amountMinor: z.coerce.number().int().positive('Enter how much you paid'),
  manualReference: z.string().trim().max(200).optional(),
});

/** Blank form fields arrive as `''`, which a bare `.optional()` would still try to coerce. */
const optionalText = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const lineItemInputSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1),
  unitPriceMinor: z.coerce.number().int().min(0),
  category: optionalText(z.string().trim().max(50)),
});

export const createInvoiceSchema = z.object({
  studentProfileId: z.string().cuid(),
  currency: optionalText(z.string().trim().length(3)),
  dueAt: optionalText(z.coerce.date()),
  description: optionalText(z.string().trim().max(500)),
  lineItems: z.array(lineItemInputSchema).min(1, 'Add at least one line item'),
});

export const rejectPaymentSchema = z.object({
  reason: z.string().trim().min(5, 'Explain why this payment could not be confirmed').max(2000),
});

export type SubmitProofOfPaymentInput = z.infer<typeof submitProofOfPaymentSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type RejectPaymentInput = z.infer<typeof rejectPaymentSchema>;
