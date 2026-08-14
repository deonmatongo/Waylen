/**
 * Reporting & analytics (PRD §5.4, §10).
 *
 * The metric set mirrors §10 so the KPIs are measurable from launch.
 */
import type { Request, Response } from 'express';
import { reportService } from '../../services/report.service.js';

export async function index(req: Request, res: Response): Promise<void> {
  const summary = await reportService.summary();

  res.render('admin/reports/index', {
    title: 'Reports',
    layout: 'layouts/admin',
    summary,
  });
}

export async function students(req: Request, res: Response): Promise<void> {
  const report = await reportService.studentFunnel();

  res.render('admin/reports/students', {
    title: 'Student funnel',
    layout: 'layouts/admin',
    report,
  });
}

export async function applications(req: Request, res: Response): Promise<void> {
  const report = await reportService.applicationConversion();

  res.render('admin/reports/applications', {
    title: 'Application conversion',
    layout: 'layouts/admin',
    report,
  });
}

export async function destinations(req: Request, res: Response): Promise<void> {
  const report = await reportService.popularDestinations();

  res.render('admin/reports/destinations', {
    title: 'Popular destinations',
    layout: 'layouts/admin',
    report,
  });
}

export async function revenue(req: Request, res: Response): Promise<void> {
  const report = await reportService.revenue();

  res.render('admin/reports/revenue', {
    title: 'Revenue',
    layout: 'layouts/admin',
    report,
  });
}

export async function exportCsv(req: Request, res: Response): Promise<void> {
  // Query values can arrive as arrays or nested objects; only accept a string.
  const requested = typeof req.query.type === 'string' ? req.query.type : 'students';
  const { rows, filename } = await reportService.exportCsv(requested);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(rows);
}
