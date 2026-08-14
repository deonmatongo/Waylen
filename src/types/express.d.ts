/**
 * Express request augmentation.
 */
import type { UserRole, UserStatus, ApplicationStage } from '@prisma/client';
import type { FlashType } from '../middleware/flash.js';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  studentProfile: {
    id: string;
    reference: string;
    currentStage: ApplicationStage;
  } | null;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by `loadCurrentUser` when a valid session exists. */
      currentUser?: CurrentUser;
      /** Queues a one-shot message to display after a redirect. */
      flash: (type: FlashType, message: string) => void;
    }
  }
}

export {};
