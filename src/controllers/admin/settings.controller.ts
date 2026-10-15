/**
 * Platform settings (super admin only).
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { features } from '../../config/env.js';
import { validateSettings } from '../../validators/settings.validator.js';
import { auditService } from '../../services/audit.service.js';

export async function index(req: Request, res: Response): Promise<void> {
  const settings = await prisma.setting.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });

  const grouped = settings.reduce<Record<string, typeof settings>>((acc, setting) => {
    (acc[setting.group] ??= []).push(setting);
    return acc;
  }, {});

  res.render('admin/settings/index', {
    title: 'Settings',
    layout: 'layouts/admin',
    grouped,
    // Feature flags come from the environment, not the database — they gate
    // whole routes and must be set before boot.
    featureFlags: features,
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  // Allow-listed keys only, each value validated — throws before any write.
  const entries = validateSettings(req.body);

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) },
      }),
    ),
  );

  await auditService.record({
    actorId: req.currentUser!.id,
    action: 'UPDATE',
    entity: 'Setting',
    changes: { keys: entries.map(([key]) => key) },
  });

  req.flash('success', 'Settings saved.');
  res.redirect('/admin/settings');
}
