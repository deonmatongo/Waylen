/**
 * The Services catalogue (PRD §4.7, §6.1).
 *
 * Held in code rather than the database because each entry has a bespoke page
 * layout and its own partner category mapping. Editorial copy that changes
 * frequently belongs in the CMS; this is structure.
 */
export interface ServiceAction {
  /** What the button says — matches how the service is actually obtained today. */
  verb: 'Book' | 'Get Quote' | 'Request' | 'Learn More';
  href: string;
}

export interface ServiceEntry {
  slug: string;
  name: string;
  summary: string;
  /** Which PRD §6.1 partner categories back this service. */
  partnerCategories: string[];
  /** Feature flag gating the in-product flow, where one exists. */
  feature?: 'payments' | 'insurance' | 'partnerDirectory' | 'community';
  icon: string;
  /**
   * Whether every student's current package includes this service (portal
   * Services page — client navigation feedback). There is only one package
   * today, so this is a flat flag rather than a per-package lookup; see
   * `src/config/packages.ts`.
   */
  included: boolean;
  /** Only add-ons need an action — included services route from the portal directly. */
  action?: ServiceAction;
}

export const SERVICE_CATALOGUE: ServiceEntry[] = [
  {
    slug: 'university-applications',
    name: 'University & programme applications',
    summary: 'End-to-end support choosing a programme and submitting a complete, verified application.',
    partnerCategories: ['INSTITUTION'],
    icon: 'graduation-cap',
    included: true,
  },
  {
    slug: 'career-guidance',
    name: 'Career guidance',
    summary: 'One-to-one sessions and personalised recommendations, from a first path to progressing into leadership.',
    partnerCategories: ['CAREER_EMPLOYER'],
    icon: 'compass',
    included: true,
  },
  {
    slug: 'consultation-booking',
    name: 'Consultation booking',
    summary:
      'Book a 45-minute session with a counsellor, online or in person, and get a clear view of your options.',
    partnerCategories: [],
    icon: 'calendar',
    included: true,
  },
  {
    slug: 'document-review',
    name: 'Document review',
    summary:
      'Every document checked and verified against the institution\'s requirements before anything is submitted.',
    partnerCategories: ['LEGAL'],
    icon: 'check-square',
    included: true,
  },
  {
    slug: 'student-insurance',
    name: 'Student insurance',
    summary:
      'Health and travel cover for studying abroad, arranged through vetted providers.',
    partnerCategories: ['INSURANCE'],
    feature: 'insurance',
    icon: 'shield',
    included: false,
    action: { verb: 'Get Quote', href: '/portal/insurance/quote' },
  },
  {
    slug: 'visa-and-legal',
    name: 'Visa & legal support',
    summary:
      'Immigration lawyers, document legalisation and translation, and visa appeal specialists.',
    partnerCategories: ['LEGAL'],
    icon: 'file-text',
    included: false,
    action: { verb: 'Request', href: '/portal/messages' },
  },
  {
    slug: 'financial-services',
    name: 'Financial services',
    summary:
      'International banking, education loans, currency transfer and fintech accounts for life in a new country.',
    partnerCategories: ['FINANCIAL_SERVICES'],
    icon: 'credit-card',
    included: false,
    action: { verb: 'Request', href: '/portal/messages' },
  },
  {
    slug: 'wealth-and-business',
    name: 'Wealth & business building',
    summary:
      'The questions that come after you have settled: credit history, mortgages, investing, company formation and business banking.',
    partnerCategories: ['WEALTH_BUSINESS'],
    icon: 'trending-up',
    included: false,
    action: { verb: 'Request', href: '/portal/messages' },
  },
  {
    slug: 'relocation',
    name: 'Accommodation & relocation',
    summary:
      'Student housing, homestay networks, airport pickup and the practical business of arriving.',
    partnerCategories: ['ACCOMMODATION_RELOCATION', 'TELECOM_BANKING_ARRIVAL'],
    icon: 'home',
    included: false,
    action: { verb: 'Request', href: '/portal/messages' },
  },
  {
    slug: 'living-abroad',
    name: 'Living abroad',
    summary:
      'Community, wellbeing and the networks that make a new country feel like somewhere you belong.',
    partnerCategories: ['WELLBEING_COMMUNITY'],
    feature: 'community',
    icon: 'users',
    included: false,
    action: { verb: 'Request', href: '/portal/messages' },
  },
  {
    slug: 'webinars',
    name: 'Webinars & events',
    summary:
      'Live sessions on destinations, scholarships and visas — plus recordings of everything you missed.',
    partnerCategories: [],
    icon: 'video',
    included: false,
    action: { verb: 'Learn More', href: '/portal/webinars' },
  },
  {
    slug: 'language-and-tests',
    name: 'Language & test preparation',
    summary: 'IELTS, TOEFL and Duolingo test centres, and language schools at every level.',
    partnerCategories: ['LANGUAGE_TEST_CENTRE'],
    icon: 'book-open',
    included: false,
    action: { verb: 'Request', href: '/portal/messages' },
  },
];
