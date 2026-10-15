/**
 * Admin-initiated erasure (GDPR Art. 17). Anonymises; never hard-deletes.
 * Mount behind super-admin/admin-staff role checks.
 */
import type { Request, Response } from 'express';
import { privacyService } from '../../services/privacy.service.js';

export async function anonymise(req: Request, res: Response): Promise<void> {
  const actor = req.currentUser!;
  const { alreadyAnonymised } = await privacyService.anonymiseUser(req.params.id as string, actor.id);

  req.flash(
    'success',
    alreadyAnonymised ? 'That account was already anonymised.' : 'Account anonymised. Financial records were kept.',
  );
  res.redirect('/admin/students');
}
