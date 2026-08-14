/**
 * Audit log viewer (PRD §8.2). Super admin only.
 */
import type { Request, Response } from 'express';
import { auditService } from '../../services/audit.service.js';

export async function index(req: Request, res: Response): Promise<void> {
  const { entity, action, actorId, page } = req.query;

  const results = await auditService.list({
    entity: typeof entity === 'string' ? entity : undefined,
    action: typeof action === 'string' ? action : undefined,
    actorId: typeof actorId === 'string' ? actorId : undefined,
    page: Number(page) || 1,
  });

  res.render('admin/audit/index', {
    title: 'Audit log',
    layout: 'layouts/admin',
    results,
    filters: { entity, action, actorId },
  });
}
