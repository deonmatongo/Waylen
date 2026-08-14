# WAYLEN — Vision & Product Requirements Document

**Public Website · Educational Portal · Partner Ecosystem**

| Field | Value |
| --- | --- |
| Prepared by | Blessing "Bee" Chinowoneka — Founder & Product Owner, Waylen |
| Prepared for | Website & Portal Development Partner |
| Document status | Version 1.0 — For Technical Review & Proposal |
| Date | August 2026 |
| Classification | Confidential — Product & Business Vision |

> **A note before you read this**
>
> This document describes the product vision and requirements — not the final UI. I would like you to review it as a software engineer and recommend the best technical architecture, user experience approach and technology stack to build a scalable platform. If you see a better way to achieve this vision, I welcome your recommendations.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Vision, Mission & Positioning](#2-vision-mission--positioning)
3. [Platform Architecture — Three Connected Layers](#3-platform-architecture--three-connected-layers)
4. [Product 1 — Public Website](#4-product-1--public-website)
5. [Product 2 — Educational Portal](#5-product-2--educational-portal)
6. [Partner Ecosystem — Beyond Admissions](#6-partner-ecosystem--beyond-admissions)
7. [Design Direction](#7-design-direction)
8. [Technical Expectations & Non-Functional Requirements](#8-technical-expectations--non-functional-requirements)
9. [Roadmap & Phasing](#9-roadmap--phasing)
10. [Success Metrics](#10-success-metrics)
11. [Roles & Ownership](#11-roles--ownership)
12. [Final Objective](#12-final-objective)
- [Appendix A — MVP Landing Page Blueprint](#appendix-a--mvp-landing-page-blueprint)

---

## 1. Introduction

Waylen is a premium, intentional guide for people building international lives — not just an education portal. We walk with ambitious individuals across Africa, and with the growing community of Africans already living and working abroad, through every stage of the journey: exploring opportunities, choosing a path, applying, relocating, building a career, and staying connected wherever in the world they land.

This document sets out the product vision, the two core systems that make up the platform, and the partner ecosystem that reinforces Waylen's role as a trusted, well-organised guide — credible enough for institutions and partners to work with, and personal enough that individuals feel genuinely accompanied, not processed. It is written to give a development partner full context — not just a list of pages — so that technical decisions are made in service of the business, not the other way around.

### 1.1 Purpose of this document

- Explain why Waylen exists and who it serves.
- Define the two connected products — the Public Website and the Educational Portal — and the boundary between them.
- Set out the partner ecosystem (insurance, financial, legal, institutional) that extends Waylen beyond admissions.
- Provide enough detail on data, roles and workflow for a development team to propose an architecture and a build plan.

### 1.2 What this document is not

This is not a wireframe or a final UI specification. Screens, layouts and exact fields are expected to evolve during design and technical discovery. What should not change is the underlying vision, the separation of the two products, and the student journey described below.

---

## 2. Vision, Mission & Positioning

### 2.1 Vision

To be the trusted guide behind every ambitious African's international journey — the platform that helps them build career, wealth and status abroad, and keeps them connected to guidance, opportunity and each other long after they've arrived, wherever in the world they build their life.

### 2.2 Mission

To walk with individuals through the entire international journey — not just admissions — from first exploring opportunities, through applications, visas and relocation, to building a career, a business and real financial standing once they've arrived. Waylen provides career guidance, financial and wealth-building guidance, and life guidance, not only education guidance, delivered through technology, transparency and genuinely personal support.

### 2.3 Positioning — a trusted guide for the whole journey

Waylen is not simply an education portal. It is a well-rounded career, wealth and life guidance platform — a partner who walks beside each person through every decision, not a directory they browse alone. That same intentionality and standard of organisation is what also makes Waylen a partner that institutions and businesses can trust to represent this community professionally.

Suggested positioning statements:

- Waylen is a trusted guide for Africans building international lives — offering education, career, wealth-building and life guidance from first exploring an opportunity through to thriving abroad.
- Waylen is a global mobility and career guidance platform, connecting ambitious individuals with vetted institutions and partners worldwide, and connecting them with each other along the way.

### 2.4 One ecosystem, two connected communities

Waylen is not only for people preparing to leave. It is equally built for Africans already living and working abroad — particularly across Europe — who are further along in building their career, wealth and standing, and still need a serious platform behind them. These two audiences are designed to reinforce each other rather than sit in separate silos:

- **Newcomers** get real, credible guidance from people who have already made the journey — not just generic country information.
- **Established professionals abroad** stay connected to a platform that keeps offering value long after arrival: career advancement, business and financial guidance, and a serious professional network — not just social community.
- **Mentors, alumni and professionals already abroad** can be matched with new applicants heading to the same country or city.
- The same platform that guided someone's move five years ago is still building with them today — as they grow their career, their business and their wealth.

### 2.5 Wealth, career and business building — the elite standard

Waylen is not positioned as a social network for people who have relocated. It is positioned as a platform for people serious about building career, wealth and standing abroad — the practical questions that come after someone has settled: how do I get a mortgage here, how do I build credit history, how do I invest, how do I start or scale a business, how do I move into leadership. This is where Waylen becomes an elite-standard platform, not a casual one:

- **Financial literacy** content and guidance built for people abroad specifically — credit history, mortgages, taxation, savings and investing in a new country.
- **Business-building support** for those starting or scaling a company abroad — company formation, business banking, and connections to relevant advisors.
- **Career advancement guidance** beyond the first job — progressing into leadership and senior roles, not just securing initial employment.
- **A curated, professional network** of established African professionals, business owners and executives abroad — the kind of access that comes from being part of a serious, vetted platform.

### 2.6 Why institutions trust Waylen

Universities, colleges and professional schools should experience Waylen as a single, accountable, well-organised partner — not an unpredictable, informal channel. The platform should demonstrate:

- A vetted, well-documented pipeline of candidates from across Africa.
- Standardised, verified documentation before any application is submitted.
- One accountable point of contact, rather than fragmented individual enquiries.
- Transparent tracking of every application from submission through to enrolment.
- A long-term presence and reputation, not a one-off recruiter relationship.

### 2.7 Why partners trust Waylen

Insurance providers, financial institutions, immigration lawyers and relocation partners should experience Waylen as an organised, professional platform. The website and portal are built to demonstrate this from first glance:

- A clear, premium brand presence across both the website and the portal.
- Documented partner criteria and a visible vetting standard.
- Structured referral tracking so partners can see the value of the relationship.
- One platform where students, alumni, institutions and partners intersect — not a scattered, ad-hoc network.

### 2.8 What people should feel

- "This platform genuinely wants to guide me — not just enrol me."
- "I can trust the information and the people here."
- "I have found a long-term partner for my career, my wealth and my life abroad, not just my application."
- "This is a serious, premium organisation — an elite standard, not a casual community."
- "This platform still has something for me, even years after I arrived — it's still helping me build."

### 2.9 Target audience

Anyone seeking to build an international career and life, wherever they currently are in that journey, together with the institutions and partners who serve them:

- Prospective undergraduate and postgraduate students
- Professionals seeking internationally recognised certifications
- Culinary, aviation, healthcare/nursing and hospitality trainees
- Business, IT and technology learners
- Anyone pursuing vocational or executive education abroad
- Established African professionals, business owners and executives already abroad — particularly across Europe — seeking career advancement, financial and wealth-building guidance, and a serious professional network
- Universities, colleges and professional schools evaluating a trusted partner
- Insurance, financial, legal and relocation partners assessing Waylen as an organisation to work with

The platform's structure should allow additional industries, countries and partner categories to be added over time without a redesign.

---

## 3. Platform Architecture — Three Connected Layers

Waylen should be built as three connected systems rather than "a website with a login." Each has a distinct purpose, a distinct audience, and a distinct data model, but they share one brand and one student identity as a user moves from visitor to student.

| Layer | Purpose | Primary audience |
| --- | --- | --- |
| **1. Public Website** | Educate, build trust, showcase opportunities and services | Prospective students, professionals, general public |
| **2. Educational Portal** | Manage the application journey once someone registers as a student | Registered students (and their assigned counsellor) |
| **3. Partner Ecosystem** | Extend value beyond admissions through vetted third parties | Students and diaspora already abroad, plus partner organisations |

A visitor should be able to move from learning on the website to becoming an active student in the portal without feeling like they have switched to a different system. The partner ecosystem then keeps the relationship alive after the student has arrived abroad — which is also where Waylen's future revenue diversification sits.

---

## 4. Product 1 — Public Website

The website is where prospective students, professionals, diaspora already abroad, institutions and business partners all meet Waylen for the first time. Its job is to build immediate confidence — confidence for individuals that they are being guided, not just processed, and confidence for institutions and partners in Waylen's organisation and credibility. It should feel like a premium career and life guidance platform for people building international futures.

### 4.1 Home

Leads with the mission, not "study abroad." Suggested framing: *"Helping ambitious people build international futures through guidance, community and global opportunity."*

- Hero banner and clear calls to action
- Featured destinations and opportunities
- Upcoming webinars
- Success stories
- Why choose Waylen
- Latest articles and community highlights
- Institution and partner logos
- Contact section

### 4.2 Opportunities

Organised by category rather than "universities only," reinforcing Waylen's scope as a broad, premium, multi-pathway platform:

- Universities & postgraduate programmes
- Language schools
- Culinary schools
- Aviation training
- Healthcare & nursing
- Hospitality & tourism
- Business & management
- Information technology
- Professional certifications
- Vocational training & executive education
- Exchange & summer programmes

Each listing includes: description, country, entry requirements, indicative tuition, duration, intake periods, scholarship information, and an apply/enquire action.

> **Specific institution names are intentionally not displayed publicly** — this protects Waylen's position as the trusted intermediary and prevents visitors bypassing the platform to apply directly. Once a student registers, a counsellor recommends the specific institution, manually or matched automatically by course and study level.

### 4.3 Countries

Destination-first pages, almost a mini-encyclopaedia for people moving abroad. Each country page should cover: education overview, cost of living, accommodation, healthcare, banking, transportation, student life, working while studying, career opportunities, visa information, popular programme types and FAQs.

Initial focus destinations: **Poland, Latvia, Lithuania, Romania, Bulgaria, Ireland and Canada** — with the country list managed by the Waylen team through the admin dashboard and expandable over time.

### 4.4 Learning Hub

The platform's biggest long-term asset: articles, country guides, downloadable resources, videos, checklists and FAQs covering programme choice, scholarships, visas, budgeting, motivation letters, CVs, culture and career planning.

### 4.5 Webinars & Events

- Browse and register for upcoming webinars
- Automated confirmation and reminder emails
- Watch recordings
- Register for physical/open-day events

### 4.6 Community & Professional Network

This is where Waylen's two audiences meet — and it should read as a professional, vetted network built around building career, wealth and business abroad, not a casual social community. It is one of Waylen's clearest points of difference, and should feel curated and elite, not open and generic:

- A student and alumni network spanning multiple African countries and destinations
- A mentorship programme pairing established professionals and business owners already abroad with new applicants heading to the same country or city
- Career and business-building circles for people at similar stages — early career, business formation, leadership progression
- Regional meetups and professional networking events, both across Africa and in host countries across Europe and beyond
- Give-back and mentorship opportunities that keep senior alumni and established professionals engaged long after they've built their own success

### 4.7 Services

Where visitors see the full breadth of support Waylen provides — education, career, wealth-building, relocation, legal and financial services, as detailed in Section 6.

### 4.8 About & Contact

- Mission, vision, values, story, team, partners, testimonials
- Contact form, WhatsApp, email, office locations, social media

### 4.9 Institutional & Partner Trust Signals

Institutions and partners will also evaluate Waylen through this website, so it should include a dedicated layer of credibility signals rather than leaving this to chance:

- Institution and partner logos, displayed prominently on the homepage and About page (with permission)
- A dedicated "For Institutions" and "For Partners" page explaining how Waylen operates as a regional representative, its vetting process, and its coverage across Africa
- Testimonials and endorsements from partner institutions, not only from students
- Visible information on team credentials, regional presence and years of operation
- Clear compliance and data-protection statements, particularly for institutional, financial and insurance partners

---

## 5. Product 2 — Educational Portal

The portal begins the moment someone registers with Waylen. It is a focused, dedicated education and application portal — closer to a study-abroad admissions system than a broad career or work platform — giving each student one transparent place to manage their journey from registration to enrolment. Broader life, community and career guidance beyond the application itself live on the website and in the partner ecosystem (Sections 4.6 and 6), not inside the portal.

### 5.1 Registration & roles

Registration should be lightweight and verified before portal access is granted:

- **Sign-up fields:** full name, official email address, password, country of origin
- **Email verification** required before accessing the portal, with phone verification planned as a future enhancement
- **User roles:** Student, Counsellor, Admin Staff and Super Admin — with an Agent role planned for a later phase (see 5.5)
- On registration, students indicate preferred course(s), destination country and study level, which feeds counsellor recommendations

### 5.2 Student-facing modules

| Module | What it does |
| --- | --- |
| **Dashboard** | Welcome, current application stage, outstanding actions, notifications, upcoming appointments |
| **My Applications** | Every application, status, timeline, required actions, institution responses |
| **Progress Tracker** | Visual stage-by-stage view of where the student is right now (see 5.3) |
| **Document Centre** | Upload passport, degree certificate/O-levels, academic transcript, CV, English proficiency results and other course-specific documents — reviewed by staff and tagged Under Review / Approved / Needs Correction |
| **Downloads** | Offer letters, acceptance letters, invoices, visa support letters, travel guides and other official documents issued by Waylen |
| **Invoices & Payments** | View invoices and payment history; pay by card, bank transfer, Revolut, SWIFT, Apple Pay or Google Pay |
| **Appointments** | Book initial consultation, career guidance, application review or visa consultation sessions (45 minutes, online or in person, with Microsoft Teams integration); automatic reminders |
| **Insurance** | Purchase student insurance directly within the portal; migrates to vetted external partners as insurance partnerships are finalised (see Section 6) |
| **Career Guidance** | Book paid one-on-one sessions, complete assessments and receive personalised recommendations |
| **Webinar Access** | Register, join, receive reminders and access recordings afterward |
| **Messages** | Secure, logged communication between student and the Waylen team |
| **Notifications** | Email and in-app at launch — covering account creation, appointment booking, webinar registration, document approval and application updates — architected to extend to SMS/WhatsApp later |
| **Resource Library** | Country packs, visa checklists, recorded webinars and templates for registered students |

### 5.3 Progress tracker — application stages

```
Profile Created → Documents Submitted → Under Review → Application Submitted
    → Offer Received → Visa Processing → Enrolled
```

This deliberately mirrors a study-abroad application workflow rather than a general life-admin tool. The portal's job is to make the application and enrolment journey transparent and simple to follow — not to manage every aspect of a student's life abroad.

### 5.4 Admin (back-office) portal

This is where the Waylen team — and Bee personally, as the person liaising with institutions — operates day to day.

| Function | Capabilities |
| --- | --- |
| **Student management** | View, search, filter students; assign counsellor; view status at a glance |
| **Document review** | Approve, reject, request resubmission, leave comments |
| **Application management** | Submit to institutions, track responses, update statuses, upload offers, record deadlines |
| **Appointment management** | View and manage bookings across consultation types and counsellors |
| **Communications** | Individual messages, bulk announcements, notification triggers |
| **Payments & invoicing** | Generate invoices, record payments/deposits, issue receipts, send reminders |
| **Webinar management** | Create webinars, manage registrations, upload recordings, attendance reports |
| **Country & content management** | Manage country pages, opportunity listings, FAQs, sponsor and partner logos |
| **CRM** | Every enquiry, consultation and student linked together end-to-end |
| **Reporting & analytics** | Registered students, applications submitted, conversion rates, popular destinations, webinar attendance |

> **A key operational requirement:** Bee, as the person corresponding directly with universities and institutions, must be able to upload acceptance letters, offer letters and other official documents on a student's file at any stage, with the student notified automatically.

### 5.5 Future: Agent Portal

Alongside student accounts, Waylen has agent relationships that may warrant their own limited-access portal in a later phase — to submit students, track referral status and view commission-relevant information, without exposing full admin capabilities. This is not required for the initial build, but the data model should not preclude it.

---

## 6. Partner Ecosystem — Beyond Admissions

This is where Waylen extends beyond admissions to become the platform that helps people build an international life — and where institutions and partners see Waylen operating as an organised regional hub. The platform should actively connect students to insurance, institutional and other trusted partners; this section sets out a structured model for that ecosystem.

### 6.1 Suggested partner categories

| Category | Example partners | Where it appears |
| --- | --- | --- |
| **Insurance** | Health & travel insurance for students abroad — purchasable directly in the portal today, migrating to vetted external partners as agreements are finalised | Portal → Insurance, Country pages, Services |
| **Financial services** | International banks, fintech accounts, education-loan providers, currency transfer services | Services → Financial, Portal → Finance |
| **Wealth & business building** | Mortgage brokers, wealth and investment advisors, business formation and business banking partners, credit-building services | Services → Financial, Community & Professional Network |
| **Legal** | Immigration lawyers, document legalisation & translation services, visa appeal specialists | Services → Legal, Portal → Document Centre |
| **Institutions** | Universities, colleges, professional & vocational schools (direct recruitment agreements) | Sponsor logos on Home/About only (display-only); matching happens via counsellor + portal, not public listings |
| **Accommodation & relocation** | Student housing platforms, homestay networks, airport pickup partners | Country pages, Services → Relocation |
| **Telecom & banking on arrival** | Local SIM providers, starter bank account partners | Portal → Resource Library, post-acceptance checklist |
| **Language & test centres** | IELTS/TOEFL/Duolingo test centres, language schools | Learning Hub, Opportunities |
| **Career & employers** | Internship providers, graduate employers, alumni-run businesses | Services → Career, Community |
| **Wellbeing & community** | Diaspora churches, student associations, mental-health/wellbeing services | Community, Services → Living Abroad |

### 6.2 How partnerships should work in the product

- A **Partner Directory** in the admin portal: partner profile, category, region/country coverage, contract/commission terms, contact, status (active/inactive).
- **Public-facing partner listings** on relevant Country and Services pages, clearly marked as trusted/vetted partners.
- **Referral tracking:** when a student is referred to a partner (e.g. an insurer or lawyer) from the portal, the system should log it against that student's file for follow-up and, where relevant, commission reconciliation.
- **Partner-linked documents:** insurance certificates, loan approval letters etc. should be storable in the student's Document Centre alongside Waylen's own documents.
- A **future Partner Portal** (Section 9.1, long-term roadmap) where select partners can view referrals relevant to them directly, rather than everything going through Waylen staff manually.

### 6.3 Why this matters for the architecture

Even if only insurance and legal partners launch first, the data model should include a generic **"Partner"** and **"Referral"** entity from day one, rather than being bolted on later. This is the single biggest reason to treat this as three products, not two.

---

## 7. Design Direction

- Modern, clean, minimal, professional
- High-quality, editorial-standard photography
- Easy navigation with clear information hierarchy
- Excellent mobile experience — most users will discover Waylen on a phone
- Accessible and fast-loading
- A premium look and feel consistent with top-tier international institutions and platforms

The website's personality should communicate knowledge, trust, professionalism, transparency, opportunity and innovation — the visual and editorial standard of a regional institution, not a listings site.

### 7.1 Existing brand assets

Waylen already has a starting point for the development partner to build from:

- A logo already exists
- **Primary brand colours: blue and black** — to be developed into a full, premium palette with the development partner
- **Reference for tone and UX:** `legalcoreusa.com` — a clean, credible, corporate-services aesthetic

---

## 8. Technical Expectations & Non-Functional Requirements

### 8.1 Baseline expectations

- Fully responsive, mobile-first
- Role-based access control (visitor, student, counsellor, admin, super admin, and — later — agent and partner)
- Secure authentication (with future support for multi-factor authentication)
- Content management system for non-technical staff to update pages, guides and opportunity listings
- Payment processing supporting card payments, bank transfer, Revolut, SWIFT, Apple Pay and Google Pay at minimum, with regional processors (e.g. Stripe, Paystack, Flutterwave) evaluated by the development partner
- Video/calendar integration for appointments, starting with Microsoft Teams
- Email automation for notifications, reminders and confirmations
- SEO-friendly structure, especially for Country and Learning Hub content
- Scalable architecture that supports new countries, industries and partner types without a rebuild
- Clear data separation between public content and student-confidential data

### 8.2 Data protection

Waylen will hold identity documents, financial information and personal data for students based in the EU and elsewhere. The build should assume **GDPR-level data protection standards from the outset** — encrypted storage for uploaded documents, an audit trail for who accessed or changed a student record, and a clear data-retention policy — with the development partner advising on the most appropriate approach for the chosen stack.

### 8.3 Open question for the developer

Bee's own framing is intentionally not prescriptive on stack or exact architecture: this document describes what the platform must do, and the development partner is invited to recommend the most robust way to build it — including whether the Website and Portal should share a codebase/monorepo or be separate applications behind a shared design system and single sign-on.

---

## 9. Roadmap & Phasing

Suggested phasing so the platform can launch without waiting for every feature — to be refined jointly with the development partner.

| Phase | Focus | Key deliverables |
| --- | --- | --- |
| **Phase 0 — Presentation MVP** | Marketing site + portal preview (non-functional) | Landing page (see Appendix A), Countries, Services, About, Webinar listing, Login/Register, Book Consultation, Student Dashboard mockup |
| **Phase 1 — Foundation** | Functional core portal | Working registration, Document Centre with staff review, Progress Tracker, basic admin dashboard, email notifications |
| **Phase 2 — Operations** | Payments & services | Invoices & Payments, Insurance purchase flow, Career Guidance booking, Appointments with Teams integration, Webinar management, CRM |
| **Phase 3 — Ecosystem** | Partner ecosystem + community + agents | Partner Directory, referral tracking, Community features, Agent Portal |
| **Phase 4 — Scale** | Intelligence + new channels | AI-powered recommendations, native mobile apps, multi-language support, scholarship matching |

### 9.1 Long-term roadmap (beyond initial build)

- AI-powered opportunity recommendations and scholarship matching
- Partner and institution self-service portals
- Alumni community and mentor matching
- Digital document vault and online learning modules
- Native mobile application
- Online/instalment payment integration
- Multi-language support and a referral programme

---

## 10. Success Metrics

Indicative KPIs so the build can include the right analytics from the start rather than retrofitting tracking later.

- **Website:** monthly visitors, enquiry conversion rate, Learning Hub engagement, webinar sign-ups
- **Portal:** registered students, consultation bookings, applications submitted, time from registration to complete document set, application-to-offer conversion, enrolments
- **Revenue:** consultation fees, application fees, insurance sales, institution commissions
- **Partner ecosystem:** number of active partner referrals per month, partner category coverage by country
- **Operational:** staff time saved versus the current WhatsApp/manual process; volume of students managed with minimal manual input

**First 6–12 month goals:** minimal user complaints, a strong base of sponsor institutions to draw on for each intake, and day-to-day student management that requires little manual staff input.

---

## 11. Roles & Ownership

| Role | Ownership |
| --- | --- |
| **Product Owner** | Blessing "Bee" Chinowoneka — vision, content approval, institution relationships, final sign-off |
| **Development Partner** | Technical architecture, UX, build, and ongoing technical recommendations |
| **Counsellors** | Day-to-day student guidance, appointments, document review and recommendations |
| **Admin Staff / Super Admin** | Platform management, reporting, configuration, sponsor and partner management |
| **Future: Agent users** | Phase 3+ — submit students, track referrals, view commission-relevant information |
| **Future: Partner users** | Read-only or limited access to referrals relevant to them (Phase 3+) |

---

## 12. Final Objective

Waylen should become more than a company website. It should stand as a trusted, premium guide for Africans building international careers and lives — supporting people from the moment they begin exploring opportunities, through their application and visa process, to a successful transition abroad, and staying genuinely useful to them for years afterward, wherever in the world they've settled. Institutions and partners should feel they are dealing with an organised, credible, long-term partner throughout.

The website educates, guides and builds trust — for individuals at every stage of the journey, and for the institutions and partners evaluating Waylen. The portal delivers transparency, efficiency and a seamless application experience. The partner ecosystem and community extend Waylen's value into the life the student is actually building abroad, interlinking newcomers with the diaspora who came before them. Every design and technical decision should be tested against this long-term vision, while allowing the platform to grow without a rebuild.

---

## Appendix A — MVP Landing Page Blueprint

This blueprint is the literal starting point for **Phase 0** (the presentation MVP referenced in Section 9): a marketing-only landing page and a non-functional portal preview, built to validate the vision and start collecting leads before the full platform is built.

### A.1 Navigation bar

Logo — Home — Services — Countries — About Us — Webinars — Contact — Login — **Get Started** (primary call to action).

### A.2 Hero section

- **Headline:** "Your Journey to Studying Abroad Starts Here."
- **Subheadline:** "Helping students secure admissions, process applications, purchase insurance, and receive expert guidance every step of the way."
- **Buttons:** Book a Free Consultation · Get Started
- **Hero imagery:** happy international students, graduation caps, university campuses or travel imagery

### A.3 Trusted by

A scrolling carousel of sponsor school logos. Until partnerships are finalised, use placeholders labelled "Partner School."

### A.4 Why choose Waylen (four cards)

- **Transparent Process** — track your application from start to finish
- **Dedicated Educational Portal** — upload documents, monitor progress and access your invoices in one place
- **Expert Counselling** — personalised advice tailored to your education goals
- **End-to-End Support** — from admission to visa guidance and insurance

### A.5 Services (icon cards, each with a "Learn More" button)

- University Applications
- Career Guidance
- Consultation Booking
- Student Insurance
- Webinars
- Document Review

### A.6 Study destinations

Country cards for the initial seven destinations — Canada, Ireland, Poland, Latvia, Lithuania, Romania and Bulgaria — each showing a brief overview, tuition range, cost of living and an "Explore" button.

### A.7 How it works (four steps)

```
Create Your Account → Upload Your Documents → Meet Your Counsellor → Begin Your Study Abroad Journey
```

### A.8 Educational Portal preview

A mockup of the dashboard, highlighting Application Status, Uploaded Documents, Invoice History, Upcoming Consultations and Notifications. It does not need to function yet at this stage — it exists to demonstrate the vision to visitors and stakeholders.

### A.9 Upcoming webinars

Example listings: "How to Study in Poland" (July 20, Register Now) and "Scholarship Opportunities in Ireland" (August 5, Reserve Seat).

### A.10 Testimonials

Placeholder testimonials and star ratings until real student stories are available.

### A.11 Call to action banner

"Ready to Begin Your Study Abroad Journey?" with **Book Consultation** and **Create Account** buttons.

### A.12 Footer

About · Services · Countries · Contact · Privacy Policy · Social Media.

### A.13 Pages included in the MVP

| Page | In MVP? |
| --- | --- |
| Home | Yes |
| Services | Yes |
| Countries | Yes |
| About Us | Yes |
| Contact | Yes |
| Webinar Listing | Yes |
| Login | Yes |
| Register | Yes |
| Book Consultation | Yes |
| Educational Portal Dashboard (mockup only) | Yes |
| Admin Dashboard | No — later phase |
| Document Upload (functional) | No — later phase |
| Payment Gateway | No — later phase |
| Insurance Purchase Flow | No — later phase |

### A.14 MVP user flow

```
Landing Page → Learn About Waylen → Explore Services → Choose Country
    → Book Consultation → Create Account → Receive Confirmation Email
```

### A.15 Why this MVP works

- Showcases the core user journey without building every backend feature
- Validates interest from prospective students before committing to the full build
- Begins collecting leads and consultation bookings immediately
- Presents a polished, realistic product vision to stakeholders and partners

Once the landing page is validated, the platform expands into the full build described in Sections 4–9: a functional Educational Portal, admin dashboard, document management, payments and insurance.

---

*Waylen · Vision & Product Requirements Document, Version 1.0. Prepared by Blessing "Bee" Chinowoneka for technical review and proposal.*
