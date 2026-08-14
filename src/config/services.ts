/**
 * The Services catalogue (PRD §4.7, §6.1).
 *
 * Held in code rather than the database because each entry has a bespoke page
 * layout and its own partner category mapping. Editorial copy that changes
 * frequently belongs in the CMS; this is structure.
 */
export interface ServiceEntry {
  slug: string;
  name: string;
  summary: string;
  /** Which PRD §6.1 partner categories back this service. */
  partnerCategories: string[];
  /** Feature flag gating the in-product flow, where one exists. */
  feature?: 'payments' | 'insurance' | 'partnerDirectory' | 'community';
  icon: string;
}

export const SERVICE_CATALOGUE: ServiceEntry[] = [
  {
    slug: 'university-applications',
    name: 'University & programme applications',
    summary:
      'End-to-end support choosing a programme, preparing documents and submitting a complete, verified application.',
    partnerCategories: ['INSTITUTION'],
    icon: 'graduation-cap',
  },
  {
    slug: 'career-guidance',
    name: 'Career guidance',
    summary:
      'One-to-one sessions, assessments and personalised recommendations — from choosing a first path through to progressing into leadership.',
    partnerCategories: ['CAREER_EMPLOYER'],
    icon: 'compass',
  },
  {
    slug: 'consultation-booking',
    name: 'Consultation booking',
    summary:
      'Book a 45-minute session with a counsellor, online or in person, and get a clear view of your options.',
    partnerCategories: [],
    icon: 'calendar',
  },
  {
    slug: 'document-review',
    name: 'Document review',
    summary:
      'Every document checked and verified against the institution\'s requirements before anything is submitted.',
    partnerCategories: ['LEGAL'],
    icon: 'check-square',
  },
  {
    slug: 'student-insurance',
    name: 'Student insurance',
    summary:
      'Health and travel cover for studying abroad, arranged through vetted providers.',
    partnerCategories: ['INSURANCE'],
    feature: 'insurance',
    icon: 'shield',
  },
  {
    slug: 'visa-and-legal',
    name: 'Visa & legal support',
    summary:
      'Immigration lawyers, document legalisation and translation, and visa appeal specialists.',
    partnerCategories: ['LEGAL'],
    icon: 'file-text',
  },
  {
    slug: 'financial-services',
    name: 'Financial services',
    summary:
      'International banking, education loans, currency transfer and fintech accounts for life in a new country.',
    partnerCategories: ['FINANCIAL_SERVICES'],
    icon: 'credit-card',
  },
  {
    slug: 'wealth-and-business',
    name: 'Wealth & business building',
    summary:
      'The questions that come after you have settled: credit history, mortgages, investing, company formation and business banking.',
    partnerCategories: ['WEALTH_BUSINESS'],
    icon: 'trending-up',
  },
  {
    slug: 'relocation',
    name: 'Accommodation & relocation',
    summary:
      'Student housing, homestay networks, airport pickup and the practical business of arriving.',
    partnerCategories: ['ACCOMMODATION_RELOCATION', 'TELECOM_BANKING_ARRIVAL'],
    icon: 'home',
  },
  {
    slug: 'living-abroad',
    name: 'Living abroad',
    summary:
      'Community, wellbeing and the networks that make a new country feel like somewhere you belong.',
    partnerCategories: ['WELLBEING_COMMUNITY'],
    feature: 'community',
    icon: 'users',
  },
  {
    slug: 'webinars',
    name: 'Webinars & events',
    summary:
      'Live sessions on destinations, scholarships and visas — plus recordings of everything you missed.',
    partnerCategories: [],
    icon: 'video',
  },
  {
    slug: 'language-and-tests',
    name: 'Language & test preparation',
    summary: 'IELTS, TOEFL and Duolingo test centres, and language schools at every level.',
    partnerCategories: ['LANGUAGE_TEST_CENTRE'],
    icon: 'book-open',
  },
];
