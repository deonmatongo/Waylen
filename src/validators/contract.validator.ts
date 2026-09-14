/**
 * Contracts & Agreements validation (client navigation feedback).
 */
import { z } from 'zod';
import { ContractStatus } from '@prisma/client';

export const issueContractSchema = z.object({
  title: z.string().trim().min(2, 'Give this agreement a title').max(150),
});

export const contractStatusSchema = z.object({
  status: z.nativeEnum(ContractStatus),
});

export type IssueContractInput = z.infer<typeof issueContractSchema>;
