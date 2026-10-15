/**
 * "Download my data" — the signed-in user's own data export (GDPR Art. 15).
 */
import type { Request, Response } from 'express';
import { privacyService } from '../../services/privacy.service.js';
import { auditService } from '../../services/audit.service.js';

export async function exportData(req: Request, res: Response): Promise<void> {
  const user = req.currentUser!;
  const data = await privacyService.exportUserData(user.id);

  await auditService.record({
    actorId: user.id,
    action: 'EXPORT',
    entity: 'User',
    entityId: user.id,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="my-waylen-data.json"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(data, null, 2));
}
