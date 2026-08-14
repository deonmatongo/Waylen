/**
 * Contact form (PRD §4.8). Submissions become CRM enquiries (§5.4).
 */
import type { Request, Response } from 'express';
import { contactSchema } from '../../validators/contact.validator.js';
import { enquiryService } from '../../services/enquiry.service.js';

export async function show(req: Request, res: Response): Promise<void> {
  res.render('public/contact', {
    title: 'Contact us',
    metaDescription:
      'Talk to the Waylen team — by form, WhatsApp or email. We reply to every enquiry.',
    values: {},
    errors: {},
  });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const parsed = contactSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(422).render('public/contact', {
      title: 'Contact us',
      values: req.body,
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  await enquiryService.create({ ...parsed.data, source: 'contact' });

  req.flash('success', 'Thank you for getting in touch. We will reply within one working day.');
  res.redirect('/contact');
}
