/**
 * Referral tracking (PRD §6.2) — logged against the student's file for
 * follow-up and commission reconciliation.
 */
import type { Request, Response } from 'express';
import { referralService } from '../../services/referral.service.js';
import { prisma } from '../../config/database.js';
import { ValidationError } from '../../utils/errors.js';

export async function index(req: Request, res: Response): Promise<void> {
  const { status, partnerId } = req.query;

  const [referrals, partners] = await Promise.all([
    referralService.list({
      status: status as never,
      partnerId: typeof partnerId === 'string' ? partnerId : undefined,
    }),
    prisma.partner.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  res.render('admin/referrals/index', {
    title: 'Referrals',
    layout: 'layouts/admin',
    referrals,
    partners,
    filters: { status, partnerId },
  });
}

export async function store(req: Request, res: Response): Promise<void> {
  const { studentProfileId, partnerId, sourceContext, notes } = req.body ?? {};
  if (!studentProfileId || !partnerId) {
    throw new ValidationError('Select both a student and a partner.');
  }

  await referralService.create({
    studentProfileId,
    partnerId,
    sourceContext: sourceContext || 'admin.manual',
    notes: notes || undefined,
    createdById: req.currentUser!.id,
  });

  req.flash('success', 'Referral logged.');
  res.redirect('/admin/referrals');
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  await referralService.updateStatus(req.params.id as string, {
    status: req.body?.status,
    actorId: req.currentUser!.id,
    commissionAmountMinor: req.body?.commissionAmountMinor
      ? Number(req.body.commissionAmountMinor)
      : undefined,
    commissionCurrency: req.body?.commissionCurrency || undefined,
  });

  req.flash('success', 'Referral updated.');
  res.redirect('/admin/referrals');
}
