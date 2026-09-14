/**
 * Domain constants derived directly from the PRD.
 *
 * These are the single source of truth for stage ordering, labels and the
 * navigation shape — views and services read from here rather than repeating
 * literals.
 */
import type { ApplicationStage, DocumentType, DocumentStatus, ContractStatus, UserRole } from '@prisma/client';

/** PRD §5.3 — the progress tracker, in order. */
export const APPLICATION_STAGE_ORDER: ApplicationStage[] = [
  'PROFILE_CREATED',
  'DOCUMENTS_SUBMITTED',
  'UNDER_REVIEW',
  'APPLICATION_SUBMITTED',
  'OFFER_RECEIVED',
  'VISA_PROCESSING',
  'ENROLLED',
];

export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  PROFILE_CREATED: 'Profile Created',
  DOCUMENTS_SUBMITTED: 'Documents Submitted',
  UNDER_REVIEW: 'Under Review',
  APPLICATION_SUBMITTED: 'Application Submitted',
  OFFER_RECEIVED: 'Offer Received',
  VISA_PROCESSING: 'Visa Processing',
  ENROLLED: 'Enrolled',
};

/**
 * Same stages, worded for the student-facing journey tracker (client
 * navigation feedback) rather than staff operations — e.g. "Under Review"
 * (a staff queue state) reads to a student as "Programme Shortlist" (what's
 * actually happening on their behalf). Used only where the tracker renders
 * for a student; admin keeps `APPLICATION_STAGE_LABELS` throughout,
 * including its own copy of the same tracker, so a stage filter and its
 * tracker never disagree on a staff page.
 */
export const APPLICATION_JOURNEY_LABELS: Record<ApplicationStage, string> = {
  PROFILE_CREATED: 'Profile',
  DOCUMENTS_SUBMITTED: 'Documents',
  UNDER_REVIEW: 'Programme Shortlist',
  APPLICATION_SUBMITTED: 'Application',
  OFFER_RECEIVED: 'Offer',
  VISA_PROCESSING: 'Visa',
  ENROLLED: 'Enrolment',
};

/**
 * A coarser 5-step path for the compact per-card indicator on My
 * Applications (client feedback) — the full 7-stage journey is more detail
 * than a card needs; the tracker on the application's own detail page still
 * shows every stage. "Programme Shortlist"/"Under Review" folds into
 * Preparing here: that review happens before Waylen submits to the
 * institution (see APPLICATION_STAGE_ORDER), not after, so it isn't a
 * distinct "in review at the university" step the way it might first read.
 */
export const APPLICATION_CARD_PATH = ['Preparing', 'Submitted', 'Offer', 'Visa', 'Enrolled'] as const;

export const APPLICATION_CARD_STEP: Record<ApplicationStage, number> = {
  PROFILE_CREATED: 0,
  DOCUMENTS_SUBMITTED: 0,
  UNDER_REVIEW: 0,
  APPLICATION_SUBMITTED: 1,
  OFFER_RECEIVED: 2,
  VISA_PROCESSING: 3,
  ENROLLED: 4,
};

export function stageIndex(stage: ApplicationStage): number {
  return APPLICATION_STAGE_ORDER.indexOf(stage);
}

/** PRD §4.2 — public-facing category labels. */
export const OPPORTUNITY_CATEGORY_LABELS = {
  UNIVERSITY_POSTGRADUATE: 'Universities & Postgraduate Programmes',
  LANGUAGE_SCHOOL: 'Language Schools',
  CULINARY_SCHOOL: 'Culinary Schools',
  AVIATION_TRAINING: 'Aviation Training',
  HEALTHCARE_NURSING: 'Healthcare & Nursing',
  HOSPITALITY_TOURISM: 'Hospitality & Tourism',
  BUSINESS_MANAGEMENT: 'Business & Management',
  INFORMATION_TECHNOLOGY: 'Information Technology',
  PROFESSIONAL_CERTIFICATION: 'Professional Certifications',
  VOCATIONAL_EXECUTIVE: 'Vocational Training & Executive Education',
  EXCHANGE_SUMMER: 'Exchange & Summer Programmes',
} as const;

export const PARTNER_CATEGORY_LABELS = {
  INSURANCE: 'Insurance',
  FINANCIAL_SERVICES: 'Financial Services',
  WEALTH_BUSINESS: 'Wealth & Business Building',
  LEGAL: 'Legal',
  INSTITUTION: 'Institutions',
  ACCOMMODATION_RELOCATION: 'Accommodation & Relocation',
  TELECOM_BANKING_ARRIVAL: 'Telecom & Banking on Arrival',
  LANGUAGE_TEST_CENTRE: 'Language & Test Centres',
  CAREER_EMPLOYER: 'Career & Employers',
  WELLBEING_COMMUNITY: 'Wellbeing & Community',
} as const;

/**
 * Documents the student is asked to upload (PRD §5.2 Document Centre), as
 * distinct from documents Waylen issues to them (Downloads).
 */
export const STUDENT_UPLOAD_DOCUMENT_TYPES: DocumentType[] = [
  'PASSPORT',
  'DEGREE_CERTIFICATE',
  'O_LEVEL_CERTIFICATE',
  'ACADEMIC_TRANSCRIPT',
  'CV',
  'ENGLISH_PROFICIENCY',
  'MOTIVATION_LETTER',
  'REFERENCE_LETTER',
  'PROOF_OF_FUNDS',
  'BIRTH_CERTIFICATE',
  'OTHER_SUPPORTING',
];

export const WAYLEN_ISSUED_DOCUMENT_TYPES: DocumentType[] = [
  'OFFER_LETTER',
  'ACCEPTANCE_LETTER',
  'VISA_SUPPORT_LETTER',
  'INVOICE_COPY',
  'TRAVEL_GUIDE',
];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  PASSPORT: 'Passport',
  DEGREE_CERTIFICATE: 'Degree Certificate',
  O_LEVEL_CERTIFICATE: 'O-Level Certificate',
  ACADEMIC_TRANSCRIPT: 'Academic Transcript',
  CV: 'CV',
  ENGLISH_PROFICIENCY: 'English Proficiency Result',
  MOTIVATION_LETTER: 'Motivation Letter',
  REFERENCE_LETTER: 'Reference Letter',
  PROOF_OF_FUNDS: 'Proof of Funds',
  BIRTH_CERTIFICATE: 'Birth Certificate',
  OTHER_SUPPORTING: 'Other Supporting Document',
  OFFER_LETTER: 'Offer Letter',
  ACCEPTANCE_LETTER: 'Acceptance Letter',
  VISA_SUPPORT_LETTER: 'Visa Support Letter',
  INVOICE_COPY: 'Invoice',
  TRAVEL_GUIDE: 'Travel Guide',
  INSURANCE_CERTIFICATE: 'Insurance Certificate',
  LOAN_APPROVAL_LETTER: 'Loan Approval Letter',
};

/**
 * Student-facing wording for DocumentStatus (client navigation feedback) —
 * "NEEDS_CORRECTION" reads to a student as "Revision Required"; the rest are
 * used as-is elsewhere via `format.humaniseEnum`, but spelling them out here
 * keeps the four Documents-area views consistent with each other.
 */
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  NEEDS_CORRECTION: 'Revision Required',
  EXPIRED: 'Expired',
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  AWAITING_SIGNATURE: 'Awaiting Signature',
  SIGNED: 'Signed',
  ACTIVE: 'Active',
};

/** The 4 tabs of the portal's one Documents section (client navigation feedback). */
export const DOCUMENTS_TABS = [
  { label: 'My uploads', href: '/portal/documents' },
  { label: 'Required documents', href: '/portal/documents/checklist' },
  { label: 'Waylen documents', href: '/portal/downloads' },
  { label: 'Contracts & agreements', href: '/portal/contracts' },
] as const;

/** Accepted upload MIME types — deliberately narrow. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/** PRD §5.2 — consultation sessions are 45 minutes. */
export const APPOINTMENT_DURATION_MINUTES = 45;

export const APPOINTMENT_TYPE_LABELS = {
  INITIAL_CONSULTATION: 'Initial Consultation',
  CAREER_GUIDANCE: 'Career Guidance',
  APPLICATION_REVIEW: 'Application Review',
  VISA_CONSULTATION: 'Visa Consultation',
} as const;

/** Roles that may reach the back-office (PRD §5.4). */
export const STAFF_ROLES: UserRole[] = ['COUNSELLOR', 'ADMIN_STAFF', 'SUPER_ADMIN'];

/** Help & Support ticket categories (client navigation feedback §10). */
export const SUPPORT_TICKET_CATEGORY_LABELS = {
  APPLICATION: 'Application',
  DOCUMENTS: 'Documents',
  PAYMENT: 'Payment',
  APPOINTMENT: 'Appointment',
  TECHNICAL_ISSUE: 'Technical Issue',
  OTHER: 'Other',
} as const;

export const SUPPORT_TICKET_STATUS_LABELS = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  AWAITING_STUDENT: 'Awaiting Student',
  RESOLVED: 'Resolved',
} as const;

/** The 2 tabs of the portal's Help & Support section (FAQ vs. tickets). */
export const SUPPORT_TABS = [
  { label: 'FAQs', href: '/portal/support' },
  { label: 'My tickets', href: '/portal/support/tickets' },
] as const;

/** PRD §4.3 — initial focus destinations, expandable via the admin dashboard. */
export const INITIAL_DESTINATIONS = [
  { name: 'Poland', isoCode: 'PL' },
  { name: 'Latvia', isoCode: 'LV' },
  { name: 'Lithuania', isoCode: 'LT' },
  { name: 'Romania', isoCode: 'RO' },
  { name: 'Bulgaria', isoCode: 'BG' },
  { name: 'Ireland', isoCode: 'IE' },
  { name: 'Canada', isoCode: 'CA' },
] as const;

/** PRD §A.1 — public navigation. */
export const PUBLIC_NAV = [
  { label: 'Home', href: '/' },
  { label: 'Services', href: '/services' },
  { label: 'Opportunities', href: '/opportunities' },
  { label: 'Resources', href: '/learning-hub' },
  { label: 'Company', href: '/about' },
];

/**
 * Portal navigation (PRD §5.2), grouped into 8 sections per the client's
 * navigation feedback rather than one entry per feature. `match` lists extra
 * path prefixes folded into a section (e.g. Career Guidance and Insurance
 * both live under Services now) so the right sidebar item still highlights
 * when a student is on one of those pages.
 */
export const PORTAL_NAV = [
  { label: 'Dashboard', href: '/portal', icon: 'grid' },
  { label: 'My Applications', href: '/portal/applications', icon: 'file-text' },
  {
    label: 'Documents',
    href: '/portal/documents',
    icon: 'upload',
    match: ['/portal/documents/checklist', '/portal/downloads', '/portal/contracts'],
  },
  { label: 'Appointments', href: '/portal/appointments', icon: 'calendar' },
  {
    label: 'Services',
    href: '/portal/services',
    icon: 'compass',
    match: ['/portal/career-guidance', '/portal/insurance'],
  },
  { label: 'Invoices & Payments', href: '/portal/invoices', icon: 'credit-card', feature: 'payments' },
  { label: 'Resources', href: '/portal/resources', icon: 'book-open', match: ['/portal/webinars'] },
  { label: 'Help & Support', href: '/portal/support', icon: 'message-circle' },
] as const;

/** PRD §5.4 — back-office navigation. */
export const ADMIN_NAV = [
  { label: 'Overview', href: '/admin', icon: 'activity', group: 'Overview' },
  { label: 'Students', href: '/admin/students', icon: 'users', group: 'Students' },
  { label: 'Applications', href: '/admin/applications', icon: 'file-text', group: 'Students' },
  { label: 'Document Review', href: '/admin/documents', icon: 'check-square', group: 'Students' },
  { label: 'Appointments', href: '/admin/appointments', icon: 'calendar', group: 'Operations' },
  { label: 'Invoices', href: '/admin/invoices', icon: 'credit-card', feature: 'payments', group: 'Operations' },
  { label: 'Webinars', href: '/admin/webinars', icon: 'video', group: 'Operations' },
  { label: 'CRM', href: '/admin/enquiries', icon: 'inbox', group: 'Operations' },
  { label: 'Support Tickets', href: '/admin/support', icon: 'message-circle', group: 'Operations' },
  { label: 'Content', href: '/admin/content', icon: 'edit', group: 'Content' },
  { label: 'Countries', href: '/admin/countries', icon: 'globe', group: 'Content' },
  { label: 'Partners', href: '/admin/partners', icon: 'briefcase', feature: 'partnerDirectory', group: 'Content' },
  { label: 'Referrals', href: '/admin/referrals', icon: 'share-2', feature: 'partnerDirectory', group: 'Content' },
  { label: 'Reports', href: '/admin/reports', icon: 'bar-chart', group: 'Analytics' },
  { label: 'Audit Log', href: '/admin/audit', icon: 'shield', role: 'SUPER_ADMIN', group: 'Analytics' },
  { label: 'Settings', href: '/admin/settings', icon: 'settings', role: 'SUPER_ADMIN', group: 'Analytics' },
];
