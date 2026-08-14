/**
 * Community & Professional Network (PRD §4.6).
 *
 * Curated and vetted by design — not an open social feed. Phase 3 in the
 * roadmap (§9), so this ships as an explanatory page plus an interest form.
 */
import type { Request, Response } from 'express';
import { features } from '../../config/env.js';

export async function index(req: Request, res: Response): Promise<void> {
  res.render('public/community', {
    title: 'Community & professional network',
    metaDescription:
      'A vetted network of students, alumni and established African professionals abroad — mentorship, career and business-building circles, and regional meetups.',
    // Until Phase 3 the page presents the vision and captures interest.
    isLive: features.community,
  });
}
