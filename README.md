# Waylen Platform

Public website · Educational Portal · Partner Ecosystem

A server-rendered MVC platform built to the specification in
[`docs/Waylen_Vision_Product_Requirements.md`](docs/Waylen_Vision_Product_Requirements.md).

---

## Status

This is a **scaffold**, not a finished product. What that means concretely:

| Area | State |
| --- | --- |
| Data model | **Complete** — 26 models and 21 enums, every PRD entity including `Partner` and `Referral` (§6.3) |
| Routing | **Complete** — 160 routes across the three layers |
| Auth, RBAC, sessions, CSRF | **Working** |
| Document Centre (upload, encrypt, review, issue, download) | **Working** |
| Application lifecycle & Progress Tracker | **Working** |
| Notifications & email | **Working** (console driver in dev) |
| Audit trail | **Working** |
| Public website | **Renders**; long-form copy comes from the CMS |
| Payments, insurance, partner directory, community | **Scaffolded** behind feature flags — see [Phasing](#phasing) |
| Privacy policy & terms | **Deliberately empty** — needs legal counsel |

Screens whose backing feature lands in a later phase display a visible
"Scaffolded" notice, so nothing looks finished when it isn't. Code that is
intentionally incomplete is marked `TODO(phase-N)`.

---

## Stack, and why

The PRD (§8.3) invites a recommendation rather than prescribing one. This is it:

| Choice | Reason |
| --- | --- |
| **Node 20 + TypeScript** | One language across the stack; strict mode catches the class of bug that matters most when handling identity documents. |
| **Express + EJS (server-rendered)** | §8.1 requires an SEO-friendly structure for Country and Learning Hub content. Server-rendered HTML is indexable by default and fast on the low-end phones most users will arrive on (§7). A React SPA would fight both requirements. |
| **One codebase, three route trees** | §8.3 asks whether website and portal should be separate apps. They share one student identity, one brand and one session — splitting them would mean building SSO and a shared design system to solve a problem we do not have. Boundaries are enforced by `src/routes/{public,portal,admin}` and RBAC, not by separate deployments. |
| **PostgreSQL + Prisma** | Relational data with real integrity requirements (an application cannot outlive its student). Prisma gives typed queries and reviewable migrations. |
| **Progressive enhancement, no SPA framework** | Every page works without JavaScript. `public/js/app.js` adds a mobile menu and upload hints; nothing is load-bearing. |

### When to revisit

- **The portal grows genuinely interactive** (live document annotation, chat) → add islands (Alpine/htmx) to the existing pages before considering an SPA.
- **Sustained traffic beyond one instance** → move sessions and rate limits to Redis (both are noted inline), and move the in-process jobs to a real scheduler.
- **Native mobile apps** (Phase 4) → extract a JSON API alongside the HTML routes; the service layer is already free of Express types, so this is additive.

---

## Getting started

Requires Node 20+ and PostgreSQL 14+.

```bash
npm install
```

Create your environment file and fill it in:

```bash
cp .env.example .env
```

Generate the three secrets it needs:

```bash
openssl rand -base64 48
```

`SESSION_SECRET` and `CSRF_SECRET` each need one of those. `DOCUMENT_ENCRYPTION_KEY` needs a 32-byte key:

```bash
openssl rand -base64 32
```

Create the database and apply the schema:

```bash
createdb waylen_dev
```

```bash
npm run db:migrate
```

Seed it with realistic development data — seven destinations, opportunities, staff, and a student mid-journey:

```bash
npm run db:seed
```

Start the dev server:

```bash
npm run dev
```

The site is at `http://localhost:3000`. Seed sign-ins are printed by the seed
command (all share one obvious development password).

---

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server with reload |
| `npm run build` | Compile TypeScript, copy views, minify CSS |
| `npm start` | Run the built app |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Seed development data (idempotent) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | Drop, re-migrate, re-seed |

---

## Architecture

Three layers, per PRD §3, sharing one identity:

```
Layer 1  Public Website     src/routes/public/    anonymous, indexable
Layer 2  Educational Portal src/routes/portal/    requireAuth + requireStudent
Layer 3  Partner Ecosystem  Partner + Referral models, admin-managed
         Back office        src/routes/admin/     requireStaff, role-narrowed
```

Request flow:

```
request
  → helmet, compression, body parsers, rate limit
  → static assets
  → session (Postgres-backed) → flash → CSRF → view locals
  → /webhooks        signature-verified, session-free
  → loadCurrentUser  attaches req.currentUser when a session exists
  → /portal          requireAuth + requireStudent
  → /admin           requireStaff, per-route requireRole
  → public routes    anonymous
  → notFound → errorHandler
```

Layering rule: **controllers never call `prisma` directly.** They call a
repository in `src/models` or a service in `src/services`. This is what keeps
institution names out of public views (PRD §4.2) and counsellor scoping in one
place — see [`src/models/README.md`](src/models/README.md).

Fuller detail, including the request lifecycle and every design decision worth
questioning: [`docs/architecture.md`](docs/architecture.md).

---

## Layout

```
docs/                    PRD (markdown), architecture, roadmap
prisma/
  schema.prisma          26 models / 21 enums, annotated with PRD references
  seed.ts                idempotent development data
src/
  server.ts              process lifecycle, graceful shutdown
  app.ts                 Express assembly (exported unlistened, for tests)
  config/                env validation, database, logger, domain constants
  models/                query layer — the M in MVC
  controllers/           public/ auth/ portal/ admin/ webhooks/
  views/                 EJS — layouts, partials, pages, emails
  routes/                the route map
  services/              business logic (auth, documents, applications, …)
  middleware/            auth, RBAC, CSRF, session, upload, audit, errors
  validators/            Zod schemas at every input boundary
  jobs/                  reminder and billing sweeps
  utils/                 errors, crypto, formatting, references
public/                  css, js, images, uploads (git-ignored)
tests/                   unit + integration
```

---

## Security

The platform holds passports, transcripts and payment data for students in the
EU, so PRD §8.2 sets GDPR-level expectations. What is implemented:

- **Documents encrypted at rest** — AES-256-GCM, per-file IV, SHA-256 integrity check on read. Authenticated encryption means tampering fails loudly rather than returning corrupted data.
- **Documents never web-served** — uploads go to `storage/`, outside the static root, and are streamed through a controller that checks access first (`Cache-Control: private, no-store`).
- **Audit trail** — append-only `AuditLog` records who viewed, changed, downloaded or exported a student record. No update or delete method exists; an editable audit log is not one.
- **Passwords** — Argon2id, 19 MiB memory cost. Progressive lockout after repeated failures.
- **RBAC fails closed** — an unknown role matches nothing. Counsellors see only their assigned students, enforced in the model layer.
- **Institution privacy** — PRD §4.2 requires institution names stay hidden publicly. Public queries never select the field, so a template cannot leak what was never fetched.
- **CSRF** on every state-changing form; webhooks are exempt and verified by provider signature over the raw body instead.
- **Session fixation** — session id regenerated on login.
- **Log redaction** — passwords, tokens, storage keys and card fields are censored at the logger.
- **Account enumeration** — login, password reset and verification resend return identical responses for known and unknown addresses.

### Before going live

- [ ] Draft the privacy policy and terms with legal counsel (both pages are deliberately empty)
- [ ] Switch `STORAGE_DRIVER=s3` and complete the S3 driver in `storage.service.ts`
- [ ] Move sessions and rate limits to Redis before running more than one instance
- [ ] Complete a payment processor: verify webhooks and make handlers idempotent (`controllers/webhooks/payment.controller.ts`)
- [ ] Complete the Microsoft Graph client in `teams.service.ts` (a stub issues placeholder links in development)
- [ ] Set a data-retention policy and add the deletion job
- [ ] Independent security review

---

## Phasing

Feature flags in `.env` line up with PRD §9, so later-phase work can be merged
and deployed before it is switched on.

| Phase | Flag | Covers |
| --- | --- | --- |
| 0 — Presentation MVP | — | Landing page, Countries, Services, About, Webinars, Login/Register, Book Consultation, portal preview |
| 1 — Foundation | — | Registration, Document Centre with review, Progress Tracker, admin dashboard, email |
| 2 — Operations | `FEATURE_PAYMENTS`, `FEATURE_INSURANCE` | Invoices, payments, insurance, Teams appointments, webinar management, CRM |
| 3 — Ecosystem | `FEATURE_PARTNER_DIRECTORY`, `FEATURE_COMMUNITY`, `FEATURE_AGENT_PORTAL` | Partner Directory, referral tracking, community, agent portal |
| 4 — Scale | — | AI recommendations, native apps, multi-language, scholarship matching |

A disabled feature returns 404, not 403 — indistinguishable from a route that
does not exist yet.

---

## Deployment notes

`npm run build` then `npm start`. The app needs:

- `DATABASE_URL` reachable, with `npm run db:migrate:deploy` already applied
- Persistent storage for `STORAGE_LOCAL_PATH`, or S3 credentials
- `NODE_ENV=production`, which enables secure cookies, HSTS and `trust proxy`
- A reverse proxy terminating TLS

`GET /healthz` is the liveness probe.

Scheduled jobs currently run in-process via `setInterval`. **They are not
guarded against multiple instances** — running two replicas means two
executions. Add an advisory-lock guard or an external scheduler before scaling
out; `src/jobs/index.ts` says the same thing at the point it matters.

---

## Conventions

- Money is always integer **minor units** (cents). Never a float.
- Anything mutating a student record goes through a service, so the audit entry and notification are written with it.
- Every input boundary validates with a Zod schema in `src/validators`.
- CSS is BEM, mobile-first, and served unbuilt in development. All tokens live in the `:root` block of `public/css/app.css` — the whole platform re-skins from there once the brand palette is agreed (PRD §7.1).
- Comments explain *why*, not *what*.
