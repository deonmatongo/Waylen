/**
 * Document Centre validation (PRD §5.2, §5.4).
 *
 * Built on `z.nativeEnum(DocumentType)` rather than a string enum so the parsed
 * value carries Prisma's `DocumentType` type through to the service layer —
 * a plain `z.enum([...])` would widen it back to `string`.
 */
import { z } from 'zod';
import { DocumentType } from '@prisma/client';
import {
  STUDENT_UPLOAD_DOCUMENT_TYPES,
  WAYLEN_ISSUED_DOCUMENT_TYPES,
} from '../config/constants.js';

/** Types a student may upload themselves. */
const studentUploadType = z
  .nativeEnum(DocumentType)
  .refine((type) => STUDENT_UPLOAD_DOCUMENT_TYPES.includes(type), {
    message: 'Choose which type of document this is',
  });

/**
 * Types staff may issue onto a student's file, including the partner-supplied
 * documents from PRD §6.2.
 */
const ISSUABLE_TYPES: DocumentType[] = [
  ...WAYLEN_ISSUED_DOCUMENT_TYPES,
  'INSURANCE_CERTIFICATE',
  'LOAN_APPROVAL_LETTER',
];

const issuableType = z
  .nativeEnum(DocumentType)
  .refine((type) => ISSUABLE_TYPES.includes(type), {
    message: 'Choose which type of document this is',
  });

export const documentUploadSchema = z.object({
  type: studentUploadType,
  applicationId: z.string().cuid().optional(),
});

/** Staff issuing a document onto a student's file (PRD §5.4). */
export const issueDocumentSchema = z.object({
  type: issuableType,
  applicationId: z.string().cuid().optional(),
  note: z.string().trim().max(1000).optional(),
});

export const reviewSchema = z.object({
  // A correction request must say what to correct, or the student cannot act.
  notes: z.string().trim().min(5, 'Explain what the student needs to correct').max(2000),
});

export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;
export type IssueDocumentInput = z.infer<typeof issueDocumentSchema>;
