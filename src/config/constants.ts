/**
 * Domain constants derived directly from the PRD.
 *
 * These are the single source of truth for stage ordering, labels and the
 * navigation shape — views and services read from here rather than repeating
 * literals.
 */
import type { ApplicationStage, DocumentType, UserRole } from '@prisma/client';

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
  {
    label: 'Services',
    href: '/services',
    children: [
      { label: 'University Applications', href: '/services/university-applications', description: 'Programme selection, documents & submission' },
      { label: 'Career Guidance', href: '/services/career-guidance', description: 'Assessments, coaching and long-term career planning' },
      { label: 'Document Review', href: '/services/document-review', description: 'Every document verified before it is submitted' },
      { label: 'Student Insurance', href: '/services/student-insurance', description: 'Health and travel cover through vetted providers' },
      { label: 'Wealth & Business', href: '/services/wealth-and-business', description: 'Credit, mortgages and company formation abroad' },
      { label: 'Book a Consultation', href: '/book-consultation', description: 'Free 45-minute session with an advisor', highlight: true },
    ],
  },
  { label: 'Opportunities', href: '/opportunities' },
  { label: 'Countries', href: '/countries' },
  {
    label: 'Resources',
    href: '/learning-hub',
    children: [
      { label: 'Learning Hub', href: '/learning-hub', description: 'Guides, articles and visa checklists' },
      { label: 'Webinars', href: '/webinars', description: 'Live and recorded sessions with our advisors' },
    ],
  },
  {
    label: 'Company',
    href: '/about',
    children: [
      { label: 'About Us', href: '/about', description: 'Our mission and the team behind Waylen' },
      { label: 'For Institutions', href: '/for-institutions', description: 'Partner with us to reach qualified students' },
      { label: 'For Partners', href: '/for-partners', description: 'Join our referral and co-advisory network' },
      { label: 'Contact', href: '/contact', description: 'Get in touch with our team directly' },
    ],
  },
];

/** PRD §5.2 — portal navigation. */
export const PORTAL_NAV = [
  { label: 'Dashboard', href: '/portal', icon: 'grid' },
  { label: 'My Applications', href: '/portal/applications', icon: 'file-text' },
  { label: 'Document Centre', href: '/portal/documents', icon: 'upload' },
  { label: 'Downloads', href: '/portal/downloads', icon: 'download' },
  { label: 'Invoices & Payments', href: '/portal/invoices', icon: 'credit-card', feature: 'payments' },
  { label: 'Appointments', href: '/portal/appointments', icon: 'calendar' },
  { label: 'Career Guidance', href: '/portal/career-guidance', icon: 'compass' },
  { label: 'Insurance', href: '/portal/insurance', icon: 'shield', feature: 'insurance' },
  { label: 'Webinars', href: '/portal/webinars', icon: 'video' },
  { label: 'Messages', href: '/portal/messages', icon: 'message-circle' },
  { label: 'Resource Library', href: '/portal/resources', icon: 'book-open' },
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
  { label: 'Content', href: '/admin/content', icon: 'edit', group: 'Content' },
  { label: 'Countries', href: '/admin/countries', icon: 'globe', group: 'Content' },
  { label: 'Partners', href: '/admin/partners', icon: 'briefcase', feature: 'partnerDirectory', group: 'Content' },
  { label: 'Referrals', href: '/admin/referrals', icon: 'share-2', feature: 'partnerDirectory', group: 'Content' },
  { label: 'Reports', href: '/admin/reports', icon: 'bar-chart', group: 'Analytics' },
  { label: 'Audit Log', href: '/admin/audit', icon: 'shield', role: 'SUPER_ADMIN', group: 'Analytics' },
  { label: 'Settings', href: '/admin/settings', icon: 'settings', role: 'SUPER_ADMIN', group: 'Analytics' },
];
