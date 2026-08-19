/**
 * Development seed.
 *
 * Creates enough real data to exercise every screen: the seven initial
 * destinations (PRD §4.3), opportunities across categories, staff accounts,
 * a student mid-journey, webinars, partners and referrals.
 *
 * Idempotent — safe to re-run. Every write is an upsert keyed on a natural
 * unique field.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { customAlphabet } from 'nanoid';

const prisma = new PrismaClient();
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

/**
 * Real content (countries, partners, opportunities, resources, webinars,
 * settings) is safe and idempotent to seed in any environment, production
 * included — that's the point of this flag. The demo staff/student accounts
 * below share one hardcoded password and are gated out of production so
 * `npm run db:seed` can never hand out real admin access with a password
 * that's sitting in plain text in this file's git history.
 */
const isProduction = process.env.NODE_ENV === 'production';

/** Development-only password. Production accounts are created via invitation. */
const DEV_PASSWORD = 'WaylenDev2026!';

const DESTINATIONS = [
  {
    isoCode: 'PL',
    slug: 'poland',
    name: 'Poland',
    flag: 'poland.png',
    hero: 'poland-hero.svg',
    summary:
      'Affordable, well-regarded universities with a growing number of English-taught programmes, and a straightforward student visa route.',
    tuitionMin: 200_000,
    tuitionMax: 450_000,
    livingCost: 60_000,
    featured: true,
    order: 1,
  },
  {
    isoCode: 'IE',
    slug: 'ireland',
    name: 'Ireland',
    flag: 'ireland.svg',
    hero: 'ireland-hero.svg',
    summary:
      'English-speaking, EU-based, with a two-year post-study work visa and a strong technology and pharmaceutical sector.',
    tuitionMin: 900_000,
    tuitionMax: 2_500_000,
    livingCost: 120_000,
    featured: true,
    order: 2,
  },
  {
    isoCode: 'CA',
    slug: 'canada',
    name: 'Canada',
    flag: 'canada.svg',
    hero: 'canada-hero.svg',
    summary:
      'A clear pathway from study to work to permanent residency, with strong institutional recognition worldwide.',
    tuitionMin: 1_100_000,
    tuitionMax: 3_200_000,
    livingCost: 130_000,
    featured: true,
    order: 3,
  },
  {
    isoCode: 'LV',
    slug: 'latvia',
    name: 'Latvia',
    flag: 'latvia.png',
    hero: 'latvia-hero.svg',
    summary:
      'Low tuition and living costs inside the EU, with respected aviation, IT and business programmes.',
    tuitionMin: 250_000,
    tuitionMax: 600_000,
    livingCost: 65_000,
    featured: false,
    order: 4,
  },
  {
    isoCode: 'LT',
    slug: 'lithuania',
    name: 'Lithuania',
    flag: 'lithuania.png',
    hero: 'lithuania-hero.svg',
    summary:
      'Strong engineering and life-sciences programmes, small class sizes and one of the EU\'s more affordable capitals.',
    tuitionMin: 250_000,
    tuitionMax: 650_000,
    livingCost: 65_000,
    featured: false,
    order: 5,
  },
  {
    isoCode: 'RO',
    slug: 'romania',
    name: 'Romania',
    flag: 'romania.svg',
    hero: 'romania-hero.svg',
    summary:
      'Well-established medical and dental schools with English-taught tracks, at a fraction of Western European cost.',
    tuitionMin: 300_000,
    tuitionMax: 800_000,
    livingCost: 55_000,
    featured: false,
    order: 6,
  },
  {
    isoCode: 'BG',
    slug: 'bulgaria',
    name: 'Bulgaria',
    flag: 'bulgaria.svg',
    hero: 'bulgaria-hero.svg',
    summary:
      'EU degrees at low cost, with growing hospitality, medicine and business programmes taught in English.',
    tuitionMin: 280_000,
    tuitionMax: 700_000,
    livingCost: 50_000,
    featured: false,
    order: 7,
  },
  {
    isoCode: 'EE',
    slug: 'estonia',
    name: 'Estonia',
    flag: 'estonia.svg',
    hero: 'estonia-hero.svg',
    summary: 'A small Baltic nation with a strong digital economy.',
    tuitionMin: 250_000,
    tuitionMax: 600_000,
    livingCost: 65_000,
    featured: false,
    order: 8,
  },
] as const;

async function seedCountries() {
  const countries = new Map<string, string>();

  for (const destination of DESTINATIONS) {
    const country = await prisma.country.upsert({
      where: { isoCode: destination.isoCode },
      // Never overwrite flag/hero on an existing row — an admin may already
      // have replaced the seed placeholder with real photography, and a
      // reseed must not silently revert that. Missing images are backfilled
      // separately below, only where the column is still empty.
      update: {},
      create: {
        isoCode: destination.isoCode,
        slug: destination.slug,
        name: destination.name,
        flagImagePath: `/img/countries/${destination.flag}`,
        heroImagePath: `/img/countries/${destination.hero}`,
        status: 'PUBLISHED',
        summary: destination.summary,
        isFeatured: destination.featured,
        displayOrder: destination.order,
        indicativeTuitionMin: destination.tuitionMin,
        indicativeTuitionMax: destination.tuitionMax,
        costOfLivingMonthly: destination.livingCost,
        currency: 'EUR',
        educationOverview: `<p>Higher education in ${destination.name} spans public universities, private institutions and specialist vocational schools. A growing number of programmes are taught entirely in English, particularly at postgraduate level.</p>`,
        costOfLiving: `<p>Budget roughly €${(destination.livingCost / 100).toFixed(0)} per month for accommodation, food, transport and personal costs. Costs are noticeably lower outside the capital.</p>`,
        accommodation:
          '<p>University halls are the cheapest option and usually the easiest to arrange from abroad. Private shared flats offer more independence at a higher cost.</p>',
        healthcare:
          '<p>Health insurance is mandatory for student visa purposes. Waylen can arrange cover that meets the local requirement before you travel.</p>',
        banking:
          '<p>Opening a local account usually requires your passport, residence registration and proof of enrolment. Some digital banks let you open an account before you arrive.</p>',
        transportation:
          '<p>Student travel passes offer substantial discounts on city transport. Intercity rail and coach networks are extensive and inexpensive.</p>',
        studentLife:
          '<p>Active international student communities, societies and sport. African student associations are well established in most university cities.</p>',
        workingWhileStudying:
          '<p>Students may generally work part-time during term and full-time in holidays, subject to visa conditions. Check the exact hours permitted on your visa.</p>',
        careerOpportunities:
          '<p>Post-study work routes vary by country and qualification level. Your counsellor will explain the specific pathway for your programme.</p>',
        visaInformation:
          '<p>You will need an acceptance letter, proof of funds, health insurance and accommodation details. Waylen prepares and checks the full pack before you apply.</p>',
        popularProgrammes:
          '<p>Business and management, information technology, engineering, nursing and healthcare, hospitality, and aviation.</p>',
        metaTitle: `Study in ${destination.name} — costs, visas and programmes | Waylen`,
        metaDescription: destination.summary.slice(0, 155),
      },
    });

    countries.set(destination.isoCode, country.id);

    // Backfill only — never touches a row that already has an image set.
    await prisma.country.updateMany({
      where: { isoCode: destination.isoCode, flagImagePath: null },
      data: { flagImagePath: `/img/countries/${destination.flag}` },
    });
    await prisma.country.updateMany({
      where: { isoCode: destination.isoCode, heroImagePath: null },
      data: { heroImagePath: `/img/countries/${destination.hero}` },
    });

    // A couple of FAQs per destination (PRD §4.3).
    const faqs = [
      {
        question: `How much does it cost to study in ${destination.name}?`,
        answer: `<p>Tuition typically ranges from €${(destination.tuitionMin / 100).toFixed(0)} to €${(destination.tuitionMax / 100).toFixed(0)} per year, depending on the institution and programme. Living costs are around €${(destination.livingCost / 100).toFixed(0)} per month.</p>`,
        order: 1,
      },
      {
        question: `Can I work while studying in ${destination.name}?`,
        answer:
          '<p>In most cases yes, part-time during term and full-time during holidays. The exact allowance depends on your visa type — your counsellor will confirm it for your situation.</p>',
        order: 2,
      },
    ];

    for (const faq of faqs) {
      const existing = await prisma.faq.findFirst({
        where: { question: faq.question, countryId: country.id },
        select: { id: true },
      });
      if (!existing) {
        await prisma.faq.create({
          data: {
            question: faq.question,
            answer: faq.answer,
            topic: 'countries',
            status: 'PUBLISHED',
            displayOrder: faq.order,
            countryId: country.id,
          },
        });
      }
    }
  }

  console.log(`✓ ${DESTINATIONS.length} countries`);
  return countries;
}

async function seedStaff() {
  const passwordHash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });

  const staff = [
    {
      email: 'bee@waylen.example',
      fullName: 'Blessing Chinowoneka',
      role: 'SUPER_ADMIN' as const,
      jobTitle: 'Founder & Product Owner',
      regions: ['Africa', 'Europe'],
    },
    {
      email: 'counsellor@waylen.example',
      fullName: 'Thandiwe Moyo',
      role: 'COUNSELLOR' as const,
      jobTitle: 'Senior Education Counsellor',
      regions: ['Southern Africa'],
    },
    {
      email: 'admin@waylen.example',
      fullName: 'Samuel Okafor',
      role: 'ADMIN_STAFF' as const,
      jobTitle: 'Operations Manager',
      regions: ['West Africa'],
    },
  ];

  const created = new Map<string, string>();

  for (const person of staff) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: {},
      create: {
        email: person.email,
        fullName: person.fullName,
        passwordHash,
        role: person.role,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        staffProfile: {
          create: { jobTitle: person.jobTitle, regions: JSON.stringify(person.regions) },
        },
      },
    });
    created.set(person.role, user.id);
  }

  console.log(`✓ ${staff.length} staff accounts`);
  return created;
}

async function seedPartners(countries: Map<string, string>) {
  const partners = [
    {
      slug: 'europa-student-cover',
      name: 'Europa Student Cover',
      category: 'INSURANCE' as const,
      description: 'Health and travel insurance designed for international students in the EU.',
      publiclyListed: true,
      countryCodes: ['PL', 'LV', 'LT', 'RO', 'BG'],
    },
    {
      slug: 'meridian-immigration-law',
      name: 'Meridian Immigration Law',
      category: 'LEGAL' as const,
      description: 'Immigration lawyers specialising in student visas and appeals.',
      publiclyListed: true,
      countryCodes: ['IE', 'CA'],
    },
    {
      slug: 'atlas-education-finance',
      name: 'Atlas Education Finance',
      category: 'FINANCIAL_SERVICES' as const,
      description: 'Education loans and currency transfer for students studying abroad.',
      publiclyListed: true,
      countryCodes: ['PL', 'IE', 'CA'],
    },
    {
      // Institutions are display-only logos — PRD §6.1.
      slug: 'partner-school-warsaw',
      name: 'Partner School — Warsaw',
      category: 'INSTITUTION' as const,
      description: 'Placeholder institution record until the partnership is announced.',
      publiclyListed: false,
      displayLogoOnly: true,
      countryCodes: ['PL'],
    },
    {
      slug: 'partner-school-dublin',
      name: 'Partner School — Dublin',
      category: 'INSTITUTION' as const,
      description: 'Placeholder institution record until the partnership is announced.',
      publiclyListed: false,
      displayLogoOnly: true,
      countryCodes: ['IE'],
    },
  ];

  const created = new Map<string, string>();

  for (const [index, partner] of partners.entries()) {
    const countryIds = partner.countryCodes
      .map((code) => countries.get(code))
      .filter((id): id is string => Boolean(id));

    const record = await prisma.partner.upsert({
      where: { slug: partner.slug },
      update: {},
      create: {
        slug: partner.slug,
        name: partner.name,
        category: partner.category,
        status: 'ACTIVE',
        description: partner.description,
        isPubliclyListed: partner.publiclyListed,
        isDisplayLogoOnly: partner.displayLogoOnly ?? false,
        isFeatured: index < 3,
        displayOrder: index,
        vettedAt: new Date(),
        vettingNotes: 'Seeded development record.',
        contactEmail: `partnerships@${partner.slug}.example`,
        commissionRateBps: partner.category === 'INSTITUTION' ? 1500 : 1000,
        countries: { connect: countryIds.map((id) => ({ id })) },
      },
    });

    created.set(partner.slug, record.id);
  }

  console.log(`✓ ${partners.length} partners`);
  return created;
}

async function seedOpportunities(
  countries: Map<string, string>,
  partners: Map<string, string>,
) {
  const opportunities = [
    {
      slug: 'bsc-computer-science-poland',
      title: 'BSc Computer Science',
      category: 'INFORMATION_TECHNOLOGY' as const,
      countryCode: 'PL',
      institutionSlug: 'partner-school-warsaw',
      studyLevel: 'UNDERGRADUATE' as const,
      duration: '3 years',
      intakes: ['October', 'February'],
      tuitionMin: 280_000,
      tuitionMax: 320_000,
      scholarship: true,
      featured: true,
    },
    {
      slug: 'msc-international-business-ireland',
      title: 'MSc International Business',
      category: 'BUSINESS_MANAGEMENT' as const,
      countryCode: 'IE',
      institutionSlug: 'partner-school-dublin',
      studyLevel: 'POSTGRADUATE' as const,
      duration: '1 year',
      intakes: ['September', 'January'],
      tuitionMin: 1_400_000,
      tuitionMax: 1_800_000,
      scholarship: true,
      featured: true,
    },
    {
      slug: 'bsc-nursing-romania',
      title: 'BSc Nursing (English track)',
      category: 'HEALTHCARE_NURSING' as const,
      countryCode: 'RO',
      studyLevel: 'UNDERGRADUATE' as const,
      duration: '4 years',
      intakes: ['October'],
      tuitionMin: 450_000,
      tuitionMax: 550_000,
      scholarship: false,
      featured: true,
    },
    {
      slug: 'commercial-pilot-licence-latvia',
      title: 'Commercial Pilot Licence (CPL)',
      category: 'AVIATION_TRAINING' as const,
      countryCode: 'LV',
      studyLevel: 'CERTIFICATION' as const,
      duration: '18 months',
      intakes: ['Rolling'],
      tuitionMin: 5_500_000,
      tuitionMax: 7_200_000,
      scholarship: false,
      featured: false,
    },
    {
      slug: 'diploma-culinary-arts-bulgaria',
      title: 'Diploma in Culinary Arts',
      category: 'CULINARY_SCHOOL' as const,
      countryCode: 'BG',
      studyLevel: 'DIPLOMA' as const,
      duration: '2 years',
      intakes: ['September', 'February'],
      tuitionMin: 320_000,
      tuitionMax: 420_000,
      scholarship: false,
      featured: false,
    },
    {
      slug: 'postgraduate-diploma-data-analytics-canada',
      title: 'Postgraduate Diploma in Data Analytics',
      category: 'INFORMATION_TECHNOLOGY' as const,
      countryCode: 'CA',
      studyLevel: 'DIPLOMA' as const,
      duration: '2 years',
      intakes: ['September', 'January', 'May'],
      tuitionMin: 1_600_000,
      tuitionMax: 2_100_000,
      scholarship: true,
      featured: true,
    },
    {
      slug: 'general-english-intensive-ireland',
      title: 'Intensive General English',
      category: 'LANGUAGE_SCHOOL' as const,
      countryCode: 'IE',
      studyLevel: 'LANGUAGE' as const,
      duration: '25 weeks',
      intakes: ['Every Monday'],
      tuitionMin: 350_000,
      tuitionMax: 480_000,
      scholarship: false,
      featured: false,
    },
    {
      slug: 'ba-hospitality-management-lithuania',
      title: 'BA Hospitality & Tourism Management',
      category: 'HOSPITALITY_TOURISM' as const,
      countryCode: 'LT',
      studyLevel: 'UNDERGRADUATE' as const,
      duration: '3.5 years',
      intakes: ['September'],
      tuitionMin: 300_000,
      tuitionMax: 380_000,
      scholarship: true,
      featured: false,
    },
  ];

  for (const opportunity of opportunities) {
    const countryId = countries.get(opportunity.countryCode);
    if (!countryId) continue;

    await prisma.opportunity.upsert({
      where: { slug: opportunity.slug },
      update: {},
      create: {
        slug: opportunity.slug,
        title: opportunity.title,
        category: opportunity.category,
        status: 'PUBLISHED',
        countryId,
        // Private — the public listing never exposes this (PRD §4.2).
        institutionId: opportunity.institutionSlug
          ? partners.get(opportunity.institutionSlug) ?? null
          : null,
        description: `<p>A well-regarded ${opportunity.title.toLowerCase()} programme, taught in English, at a vetted partner institution. Your counsellor will recommend the specific institution once you have registered and your documents are approved.</p>`,
        entryRequirements:
          '<ul><li>Completed secondary or undergraduate qualification, as appropriate to the level</li><li>Academic transcript</li><li>Proof of English proficiency (IELTS, TOEFL or equivalent)</li><li>Valid passport</li></ul>',
        studyLevel: opportunity.studyLevel,
        duration: opportunity.duration,
        intakePeriods: JSON.stringify(opportunity.intakes),
        indicativeTuitionMin: opportunity.tuitionMin,
        indicativeTuitionMax: opportunity.tuitionMax,
        currency: 'EUR',
        scholarshipAvailable: opportunity.scholarship,
        scholarshipDetails: opportunity.scholarship
          ? '<p>Partial tuition scholarships are available for strong academic records. Your counsellor will advise on eligibility and deadlines.</p>'
          : null,
        isFeatured: opportunity.featured,
      },
    });
  }

  console.log(`✓ ${opportunities.length} opportunities`);
}

async function seedContent() {
  const resources = [
    {
      slug: 'how-to-write-a-motivation-letter',
      title: 'How to write a motivation letter that gets read',
      type: 'ARTICLE' as const,
      excerpt:
        'Admissions officers read hundreds of these. Here is what makes yours worth finishing.',
      readMinutes: 7,
      tags: ['applications', 'writing'],
    },
    {
      slug: 'student-visa-document-checklist',
      title: 'Student visa document checklist',
      type: 'CHECKLIST' as const,
      excerpt: 'Everything you need to gather before your visa appointment, in order.',
      readMinutes: 4,
      tags: ['visas', 'documents'],
    },
    {
      slug: 'budgeting-for-your-first-year-abroad',
      title: 'Budgeting for your first year abroad',
      type: 'ARTICLE' as const,
      excerpt:
        'The costs people forget: registration fees, deposits, winter clothing and the gap before your first payslip.',
      readMinutes: 9,
      tags: ['money', 'living-abroad'],
    },
    {
      slug: 'building-credit-history-in-a-new-country',
      title: 'Building credit history in a new country',
      type: 'ARTICLE' as const,
      excerpt:
        'Why your credit record does not travel with you, and how to start building one from scratch.',
      readMinutes: 8,
      tags: ['money', 'wealth-building'],
    },
    {
      slug: 'country-pack-poland',
      title: 'Country pack: Poland',
      type: 'COUNTRY_GUIDE' as const,
      excerpt: 'Registration, banking, healthcare and the first two weeks after you land.',
      readMinutes: 12,
      tags: ['poland', 'arrival'],
      requiresAuth: true,
    },
  ];

  for (const resource of resources) {
    await prisma.resource.upsert({
      where: { slug: resource.slug },
      update: {},
      create: {
        slug: resource.slug,
        title: resource.title,
        type: resource.type,
        status: 'PUBLISHED',
        excerpt: resource.excerpt,
        body: `<p>${resource.excerpt}</p><h2>Getting started</h2><p>This is seeded development content. Real articles are authored by the Waylen team through the admin CMS.</p><h2>What to do next</h2><p>Book a consultation if you would like to talk any of this through with a counsellor.</p>`,
        readMinutes: resource.readMinutes,
        tags: JSON.stringify(resource.tags),
        requiresAuth: resource.requiresAuth ?? false,
        publishedAt: new Date(),
        metaTitle: `${resource.title} | Waylen Learning Hub`,
        metaDescription: resource.excerpt.slice(0, 155),
      },
    });
  }

  // PRD §A.10 explicitly allows placeholders until real stories are available.
  const testimonials = [
    {
      authorName: 'Chiedza M.',
      authorRole: 'MSc International Business',
      countryName: 'Ireland',
      quote:
        'I always knew exactly what stage my application was at. Nothing was ever a mystery, and I never had to chase anyone for an update.',
      rating: 5,
      order: 1,
    },
    {
      authorName: 'Kwame A.',
      authorRole: 'BSc Computer Science',
      countryName: 'Poland',
      quote:
        'My counsellor caught two problems with my transcripts before they became a rejection. That alone was worth it.',
      rating: 5,
      order: 2,
    },
    {
      authorName: 'Amara O.',
      authorRole: 'Software Engineer, five years abroad',
      countryName: 'Canada',
      quote:
        'They helped me get here. Five years on, they are still the people I ask about mortgages and setting up my company.',
      rating: 5,
      order: 3,
    },
  ];

  for (const testimonial of testimonials) {
    const existing = await prisma.testimonial.findFirst({
      where: { authorName: testimonial.authorName },
      select: { id: true },
    });
    if (!existing) {
      await prisma.testimonial.create({
        data: {
          authorName: testimonial.authorName,
          authorRole: testimonial.authorRole,
          countryName: testimonial.countryName,
          quote: testimonial.quote,
          rating: testimonial.rating,
          source: 'STUDENT',
          status: 'PUBLISHED',
          isFeatured: true,
          displayOrder: testimonial.order,
        },
      });
    }
  }

  console.log(`✓ ${resources.length} resources, ${testimonials.length} testimonials`);
}

async function seedWebinars() {
  const now = Date.now();
  const day = 86_400_000;

  const webinars = [
    {
      slug: 'how-to-study-in-poland',
      title: 'How to study in Poland',
      description:
        'Costs, English-taught programmes, the visa process and what your first month actually looks like.',
      startsIn: 12 * day,
      capacity: 200,
      host: 'Thandiwe Moyo',
    },
    {
      slug: 'scholarship-opportunities-in-ireland',
      title: 'Scholarship opportunities in Ireland',
      description:
        'Which scholarships exist, who actually qualifies, and how to build an application that competes.',
      startsIn: 26 * day,
      capacity: 150,
      host: 'Samuel Okafor',
    },
    {
      slug: 'building-wealth-as-an-african-professional-abroad',
      title: 'Building wealth as an African professional abroad',
      description:
        'Credit history, mortgages, investing and starting a business once you have settled.',
      startsIn: 40 * day,
      capacity: 300,
      host: 'Blessing Chinowoneka',
    },
    {
      slug: 'choosing-between-canada-and-the-eu',
      title: 'Choosing between Canada and the EU',
      description: 'A recorded session comparing cost, work rights and long-term settlement routes.',
      startsIn: -18 * day,
      capacity: 200,
      host: 'Thandiwe Moyo',
      recording: 'https://example.com/recordings/canada-vs-eu',
    },
  ];

  for (const webinar of webinars) {
    const startsAt = new Date(now + webinar.startsIn);

    await prisma.webinar.upsert({
      where: { slug: webinar.slug },
      update: {},
      create: {
        slug: webinar.slug,
        title: webinar.title,
        status: 'PUBLISHED',
        description: `<p>${webinar.description}</p>`,
        format: 'ONLINE',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        timezone: 'Europe/Dublin',
        hostName: webinar.host,
        capacity: webinar.capacity,
        recordingUrl: webinar.recording ?? null,
      },
    });
  }

  console.log(`✓ ${webinars.length} webinars`);
}

/**
 * A student mid-journey, so the portal has something real to render: approved
 * documents, one still needing correction, an application at OFFER_RECEIVED
 * with a full event timeline, an appointment and a partner referral.
 */
async function seedStudent(
  countries: Map<string, string>,
  staff: Map<string, string>,
  partners: Map<string, string>,
) {
  const passwordHash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });
  const counsellorId = staff.get('COUNSELLOR') ?? null;

  const user = await prisma.user.upsert({
    where: { email: 'student@waylen.example' },
    update: {},
    create: {
      email: 'student@waylen.example',
      fullName: 'Tariro Nyathi',
      phone: '+263 77 000 0000',
      passwordHash,
      role: 'STUDENT',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      studentProfile: {
        create: {
          reference: `WYL-STU-${nanoid()}`,
          city: 'Harare',
          preferredStudyLevel: 'POSTGRADUATE',
          preferredCourses: JSON.stringify(['International Business', 'Data Analytics']),
          assignedCounsellorId: counsellorId,
          currentStage: 'OFFER_RECEIVED',
          preferredDestinations: {
            connect: [{ isoCode: 'IE' }, { isoCode: 'CA' }],
          },
        },
      },
    },
    include: { studentProfile: true },
  });

  const profile = user.studentProfile;
  if (!profile) return;

  // Only seed the journey once.
  const existingApplication = await prisma.application.findFirst({
    where: { studentProfileId: profile.id },
    select: { id: true },
  });
  if (existingApplication) {
    console.log('✓ student journey already seeded');
    return;
  }

  const opportunity = await prisma.opportunity.findUnique({
    where: { slug: 'msc-international-business-ireland' },
    select: { id: true },
  });

  const application = await prisma.application.create({
    data: {
      reference: `WYL-APP-${nanoid()}`,
      studentProfileId: profile.id,
      opportunityId: opportunity?.id ?? null,
      countryId: countries.get('IE') ?? null,
      institutionId: partners.get('partner-school-dublin') ?? null,
      programmeName: 'MSc International Business',
      studyLevel: 'POSTGRADUATE',
      intakePeriod: 'September',
      stage: 'OFFER_RECEIVED',
      outcome: 'OFFER_CONDITIONAL',
      submittedAt: new Date(Date.now() - 21 * 86_400_000),
      decisionAt: new Date(Date.now() - 4 * 86_400_000),
      studentNotes:
        'Conditional offer received — the condition is your final transcript. Send it as soon as your results are released.',
      applicationDeadline: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  // The event timeline behind the progress tracker (PRD §5.3).
  const timeline = [
    { stage: 'PROFILE_CREATED' as const, note: 'Application created', daysAgo: 40 },
    { stage: 'DOCUMENTS_SUBMITTED' as const, note: 'Documents uploaded by student', daysAgo: 34 },
    { stage: 'UNDER_REVIEW' as const, note: 'Documents under review by the Waylen team', daysAgo: 30 },
    { stage: 'APPLICATION_SUBMITTED' as const, note: 'Submitted to the institution', daysAgo: 21 },
    { stage: 'OFFER_RECEIVED' as const, note: 'Conditional offer received', daysAgo: 4 },
  ];

  for (const event of timeline) {
    await prisma.applicationEvent.create({
      data: {
        applicationId: application.id,
        stage: event.stage,
        note: event.note,
        actorId: counsellorId,
        createdAt: new Date(Date.now() - event.daysAgo * 86_400_000),
      },
    });
  }

  // Documents in a mix of states, so the review UI has something to show.
  const documents = [
    { type: 'PASSPORT' as const, status: 'APPROVED' as const, filename: 'passport.pdf' },
    { type: 'ACADEMIC_TRANSCRIPT' as const, status: 'APPROVED' as const, filename: 'transcript.pdf' },
    { type: 'DEGREE_CERTIFICATE' as const, status: 'APPROVED' as const, filename: 'degree.pdf' },
    { type: 'CV' as const, status: 'UNDER_REVIEW' as const, filename: 'cv.pdf' },
    {
      type: 'ENGLISH_PROFICIENCY' as const,
      status: 'NEEDS_CORRECTION' as const,
      filename: 'ielts.jpg',
      notes: 'The scan is cut off on the right edge — please upload the full page as a PDF.',
    },
  ];

  for (const document of documents) {
    await prisma.document.create({
      data: {
        studentProfileId: profile.id,
        applicationId: application.id,
        type: document.type,
        status: document.status,
        originalFilename: document.filename,
        // Seeded metadata only — no file is written to storage, so downloads
        // for these records will (correctly) 404.
        storageKey: `documents/${profile.id}/seed-${document.type.toLowerCase()}.enc`,
        mimeType: document.filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
        sizeBytes: 480_000,
        uploadedById: user.id,
        reviewedById: document.status === 'UNDER_REVIEW' ? null : counsellorId,
        reviewedAt: document.status === 'UNDER_REVIEW' ? null : new Date(),
        reviewNotes: document.notes ?? null,
        isIssuedByWaylen: false,
      },
    });
  }

  // A Waylen-issued document, so Downloads is not empty.
  await prisma.document.create({
    data: {
      studentProfileId: profile.id,
      applicationId: application.id,
      type: 'OFFER_LETTER',
      status: 'APPROVED',
      originalFilename: 'conditional-offer-letter.pdf',
      storageKey: `documents/${profile.id}/seed-offer-letter.enc`,
      mimeType: 'application/pdf',
      sizeBytes: 220_000,
      uploadedById: staff.get('SUPER_ADMIN') ?? user.id,
      reviewedById: staff.get('SUPER_ADMIN') ?? null,
      reviewedAt: new Date(),
      reviewNotes: 'Conditional on your final transcript.',
      isIssuedByWaylen: true,
    },
  });

  await prisma.appointment.create({
    data: {
      reference: `WYL-APT-${nanoid()}`,
      studentProfileId: profile.id,
      counsellorId,
      type: 'VISA_CONSULTATION',
      status: 'CONFIRMED',
      format: 'ONLINE',
      startsAt: new Date(Date.now() + 5 * 86_400_000),
      durationMinutes: 45,
      timezone: 'Africa/Harare',
      meetingUrl: 'https://teams.microsoft.com/l/meetup-join/stub/seed',
      studentNotes: 'Want to go through the proof-of-funds requirement.',
    },
  });

  // Invoicing — one open invoice with a payment awaiting confirmation, and one
  // already partially paid, so the Finances screens have real data (PRD §5.2).
  const applicationFeeInvoice = await prisma.invoice.create({
    data: {
      number: `INV-${new Date().getFullYear()}-00001`,
      studentProfileId: profile.id,
      status: 'SENT',
      currency: 'EUR',
      subtotalMinor: 25_000,
      totalMinor: 25_000,
      description: 'Application support — Autumn intake',
      issuedAt: new Date(Date.now() - 10 * 86_400_000),
      dueAt: new Date(Date.now() + 14 * 86_400_000),
      lineItems: {
        create: [
          {
            description: 'Application support fee',
            quantity: 1,
            unitPriceMinor: 25_000,
            totalMinor: 25_000,
            category: 'APPLICATION_FEE',
          },
        ],
      },
    },
  });

  await prisma.payment.create({
    data: {
      invoiceId: applicationFeeInvoice.id,
      method: 'BANK_TRANSFER',
      status: 'PENDING',
      amountMinor: 25_000,
      currency: 'EUR',
      manualReference: 'TRF-SEED-0001',
      // Seeded metadata only — no file is written to storage, so opening this
      // receipt will (correctly) 404, same as the seeded documents above.
      receiptPath: `documents/${profile.id}/seed-proof-of-payment.enc`,
    },
  });

  const careerGuidanceInvoice = await prisma.invoice.create({
    data: {
      number: `INV-${new Date().getFullYear()}-00002`,
      studentProfileId: profile.id,
      status: 'PARTIALLY_PAID',
      currency: 'EUR',
      subtotalMinor: 15_000,
      totalMinor: 15_000,
      paidMinor: 7_500,
      description: 'Career guidance package',
      issuedAt: new Date(Date.now() - 20 * 86_400_000),
      dueAt: new Date(Date.now() + 7 * 86_400_000),
      lineItems: {
        create: [
          {
            description: 'Career guidance sessions (3x)',
            quantity: 3,
            unitPriceMinor: 5_000,
            totalMinor: 15_000,
            category: 'CAREER_SESSION',
          },
        ],
      },
    },
  });

  await prisma.payment.create({
    data: {
      invoiceId: careerGuidanceInvoice.id,
      method: 'REVOLUT',
      status: 'SUCCEEDED',
      amountMinor: 7_500,
      currency: 'EUR',
      manualReference: 'RVLT-SEED-0002',
      recordedById: counsellorId,
      paidAt: new Date(Date.now() - 15 * 86_400_000),
    },
  });

  // A partner referral, so the ecosystem layer has data from day one (PRD §6.3).
  const insurerId = partners.get('europa-student-cover');
  if (insurerId) {
    await prisma.referral.create({
      data: {
        studentProfileId: profile.id,
        partnerId: insurerId,
        status: 'CONTACTED',
        sourceContext: 'portal.insurance',
        notes: 'Student asked about cover meeting the Irish visa requirement.',
        createdById: counsellorId,
      },
    });
  }

  await prisma.messageThread.create({
    data: {
      studentProfileId: profile.id,
      subject: 'Final transcript for my conditional offer',
      lastMessageAt: new Date(Date.now() - 2 * 86_400_000),
      messages: {
        create: [
          {
            senderId: user.id,
            body: 'My results come out on the 14th. Should I send the transcript straight away or wait for the certified copy?',
            createdAt: new Date(Date.now() - 3 * 86_400_000),
          },
          {
            senderId: counsellorId ?? user.id,
            body: 'Send the unofficial one as soon as you have it so we can start the review, then the certified copy when it arrives.',
            createdAt: new Date(Date.now() - 2 * 86_400_000),
          },
        ],
      },
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: user.id,
        channel: 'IN_APP',
        eventKey: 'application.offer_received',
        title: 'You have received an offer',
        body: 'A conditional offer for MSc International Business.',
        actionUrl: `/portal/applications/${application.id}`,
        sentAt: new Date(Date.now() - 4 * 86_400_000),
      },
      {
        userId: user.id,
        channel: 'IN_APP',
        eventKey: 'document.needs_correction',
        title: 'English Proficiency Result needs correction',
        body: 'The scan is cut off on the right edge.',
        actionUrl: '/portal/documents',
        sentAt: new Date(Date.now() - 6 * 86_400_000),
      },
    ],
  });

  console.log('✓ student journey (documents, application, appointment, referral, messages)');
}

async function seedEnquiries() {
  const enquiries = [
    {
      fullName: 'Nomsa Dube',
      email: 'nomsa.dube@example.com',
      message: 'I want to study nursing in Romania. What are the requirements?',
      source: 'contact',
      countryOfInterest: 'Romania',
      status: 'NEW' as const,
    },
    {
      fullName: 'Emeka Nwosu',
      email: 'emeka.nwosu@example.com',
      message: 'Looking at postgraduate data analytics in Canada for September.',
      source: 'book-consultation',
      countryOfInterest: 'Canada',
      status: 'CONTACTED' as const,
    },
  ];

  for (const enquiry of enquiries) {
    const existing = await prisma.enquiry.findFirst({
      where: { email: enquiry.email },
      select: { id: true },
    });
    if (!existing) await prisma.enquiry.create({ data: enquiry });
  }

  console.log(`✓ ${enquiries.length} enquiries`);
}

async function seedSettings() {
  const settings = [
    { key: 'contact.email', value: 'hello@waylen.example', group: 'contact' },
    { key: 'contact.phone', value: '+353 1 000 0000', group: 'contact' },
    { key: 'contact.whatsapp', value: '+353 86 000 0000', group: 'contact' },
    { key: 'contact.office.primary', value: 'Dublin, Ireland', group: 'contact' },
    { key: 'contact.office.secondary', value: 'Harare, Zimbabwe', group: 'contact' },
    { key: 'social.linkedin', value: 'https://linkedin.com/company/waylen', group: 'social' },
    { key: 'social.instagram', value: 'https://instagram.com/waylen', group: 'social' },
    { key: 'consultation.duration_minutes', value: '45', group: 'operations' },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }

  console.log(`✓ ${settings.length} settings`);
}

async function main() {
  console.log(`\nSeeding Waylen ${isProduction ? 'production' : 'development'} database…\n`);

  // Real content — safe in every environment.
  const countries = await seedCountries();
  const partners = await seedPartners(countries);
  await seedOpportunities(countries, partners);
  await seedContent();
  await seedWebinars();
  await seedEnquiries();
  await seedSettings();

  if (isProduction) {
    console.log(`
Done. Production mode: skipped the demo staff/student accounts — they share
one hardcoded password that's in this file's git history, so they're never
created outside development. Invite real staff from /admin/users.
`);
    return;
  }

  // Demo accounts — development only (see isProduction above).
  const staff = await seedStaff();
  await seedStudent(countries, staff, partners);

  console.log(`
Done. Development sign-ins (password: ${DEV_PASSWORD})

  Super admin   bee@waylen.example
  Counsellor    counsellor@waylen.example
  Admin staff   admin@waylen.example
  Student       student@waylen.example
`);
}

main()
  .catch((err) => {
    console.error('\nSeed failed:\n', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
