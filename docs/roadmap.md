# Roadmap

Derived from PRD §9, with the current state of each item.

Legend: **✅ working** · **🟡 scaffolded** (route, controller and view exist;
persistence or integration pending) · **⬜ not started**

---

## Phase 0 — Presentation MVP

Marketing site plus a portal preview, to validate the vision and start
collecting leads (PRD Appendix A).

| Item | State | Notes |
| --- | --- | --- |
| Landing page (A.2–A.12) | ✅ | All Appendix A sections, data-driven |
| Countries index & detail | ✅ | Full §4.3 encyclopaedia structure |
| Services index & detail | ✅ | Catalogue in `src/config/services.ts`; long-form copy → CMS |
| About / For Institutions / For Partners | ✅ | Trust-signal layer per §4.9 |
| Webinar listing & detail | ✅ | Registration form posts; persistence is Phase 1 |
| Login / Register | ✅ | Working, with email verification |
| Book Consultation | ✅ | Guest booking + CRM enquiry, no account needed |
| Portal dashboard | ✅ | Real dashboard, not a mockup — went further than A.8 |
| Privacy policy / Terms | ⬜ | **Needs legal counsel.** Deliberately left empty |
| Brand assets | ⬜ | Logo, hero imagery, favicon, OG image — none supplied yet |

**To ship Phase 0:** supply brand assets, draft the two legal pages, write the
service and About copy in the admin CMS, deploy with all feature flags off.

---

## Phase 1 — Foundation

Functional core portal.

| Item | State | Notes |
| --- | --- | --- |
| Registration & email verification | ✅ | Argon2id, single-use tokens, lockout |
| Document Centre — upload | ✅ | Encrypted at rest, type-restricted |
| Document Centre — staff review | ✅ | Approve / request correction, student notified |
| Waylen-issued documents | ✅ | PRD §5.4 key operational requirement |
| Progress Tracker | ✅ | Seven stages, derived from the event timeline |
| Admin dashboard & student management | ✅ | Search, filter, counsellor assignment |
| Email notifications | ✅ | 13 templates; console driver in dev |
| Application management | ✅ | Stage/outcome changes, submit-to-institution guard |
| CMS — create/edit content | 🟡 | List views work; `store`/`update` actions marked `TODO(phase-1)` |
| CMS — countries | 🟡 | Same; adding a country must never need a code change |
| Webinar registration persistence | 🟡 | Form posts; controller marked `TODO(phase-1)` |
| Staff invitations | 🟡 | Role changes work; invite flow pending |
| Enquiry notification to duty counsellor | 🟡 | Enquiries are stored; alerting pending |

**Also needed:** SMTP credentials, S3 driver completed, integration tests for
the access-control cases in `tests/integration/README.md`.

---

## Phase 2 — Operations

Payments and services. Flags: `FEATURE_PAYMENTS`, `FEATURE_INSURANCE`.

| Item | State | Notes |
| --- | --- | --- |
| Invoice data model & numbering | ✅ | Gap-free sequence inside the insert transaction |
| Manual payment reconciliation | ✅ | Bank transfer, SWIFT, Revolut — never arrive by webhook |
| Invoice views (student & admin) | ✅ | Render real data |
| Online payment (card, Apple/Google Pay) | 🟡 | Processor not chosen; webhooks verify signatures but do not process |
| Invoice creation UI | 🟡 | `billingService.createInvoice` is complete; the line-item form is not |
| Receipts & payment reminders | 🟡 | Overdue sweep works; emails pending |
| Insurance purchase flow | 🟡 | Model and views exist; needs a contracted partner |
| Career guidance assessments | 🟡 | Booking works via appointments; scoring pending |
| Appointments + Microsoft Teams | 🟡 | Booking, confirmation and reminders work; Graph client is a stub |
| Real counsellor availability | ⬜ | Currently a fixed weekday pattern; replace with Graph free/busy |
| Webinar management | 🟡 | Listing, registrations and attendance report work; create/edit pending |
| CRM | ✅ | Enquiries linked end-to-end through to student accounts |

**Decision needed:** payment processor per region. PRD §8.1 names Stripe,
Paystack and Flutterwave as candidates. The `Payment` model already carries
`provider` + `providerReference`, so more than one can coexist.

---

## Phase 3 — Ecosystem

Flags: `FEATURE_PARTNER_DIRECTORY`, `FEATURE_COMMUNITY`, `FEATURE_AGENT_PORTAL`.

| Item | State | Notes |
| --- | --- | --- |
| Partner + Referral data model | ✅ | Present from day one per PRD §6.3 |
| Referral tracking & commission | ✅ | Create, status transitions, commission attribution |
| Partner Directory (admin) | 🟡 | Listing and detail work; create/edit pending |
| Public partner listings | ⬜ | On Country and Services pages, marked as vetted |
| Partner-linked documents | ✅ | `Document.partnerId` — insurance certificates etc. |
| Community & professional network | 🟡 | Explanatory page + interest capture; features pending |
| Mentorship matching | ⬜ | `StudentProfile.isAlumni` exists to build on |
| Agent Portal | ⬜ | `AGENT` role and `referredByPartner` already in the schema |
| Partner self-service portal | ⬜ | `PARTNER` role and `StaffProfile.partnerId` already in the schema |

The schema does not preclude any of these — PRD §5.5 asked for exactly that.

---

## Phase 4 — Scale

| Item | State |
| --- | --- |
| AI opportunity & scholarship matching | ⬜ |
| Native mobile apps | ⬜ — extract a JSON API; services are already framework-free |
| Multi-language support | ⬜ — no i18n layer yet; strings are inline in views |
| Digital document vault | ⬜ — encrypted storage already underpins it |
| Referral programme | ⬜ |

---

## Cross-cutting, not tied to a phase

**Before a second instance runs:**
- Move rate limiting to Redis (currently per-process)
- Guard scheduled jobs against concurrent execution (currently `setInterval` in-process — N replicas send N reminder emails)

**Before launch:**
- Legal review of privacy policy and terms
- Data-retention policy and deletion job (PRD §8.2)
- Independent security review
- S3 storage driver
- Image resizing pipeline (`sharp` installed, unused)

**As content grows:**
- Postgres full-text search (currently `ILIKE`)
- Sanitise CMS HTML if authoring opens beyond trusted staff

**Analytics:** PRD §10 KPIs are queryable today via `reportService` — student
funnel, application conversion, popular destinations, revenue by category and
partner referrals. Front-end analytics (visitors, Learning Hub engagement) still
needs a privacy-respecting tool chosen and installed.
