/**
 * Platform settings (super admin only).
 */
import type { Request, Response } from 'express';
import { prisma } from '../../config/database.js';
import { features } from '../../config/env.js';

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
  const entries = Object.entries(req.body ?? {}).filter(([key]) => key !== '_csrf');

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) },
      }),
    ),
  );

  req.flash('success', 'Settings saved.');
  res.redirect('/admin/settings');
}
