# Architecture

Companion to [`Waylen_Vision_Product_Requirements.md`](Waylen_Vision_Product_Requirements.md).
That document says what the platform must do; this one says how it is built and
which decisions are worth revisiting.

---

## 1. The shape of the thing

PRD §3 describes three connected systems sharing one identity. That maps onto
three route trees in one codebase:

| PRD layer | Code | Access |
| --- | --- | --- |
| 1. Public Website | `src/routes/public/` | Anonymous, indexable |
| 2. Educational Portal | `src/routes/portal/` | `requireAuth` + `requireStudent` |
| 3. Partner Ecosystem | `Partner` / `Referral` models, admin-managed | Staff, later partner users |
| Back office | `src/routes/admin/` | `requireStaff`, narrowed per route |

### Why one codebase and not two applications

PRD §8.3 explicitly leaves this open. One codebase, because:

- **One identity.** A visitor becomes a student without changing systems (§3). Two apps would need SSO between them — infrastructure to solve a problem we would have created.
- **One design system.** Splitting means either duplicating the CSS or extracting a package and versioning it. Neither buys anything while one team ships both.
- **The boundary that matters is authorisation, not deployment.** A separate portal app does not make `/portal` safer; `requireAuth` does.

The cost is a shared deploy: a marketing copy change ships the portal too. That
is acceptable at this scale and reversible — the service layer takes no Express
types, so lifting `/portal` into its own app later is mechanical.

Revisit if: separate teams own website and portal, or the two need genuinely
different release cadences.

### Why server-rendered

Two PRD requirements point the same way:

- **§8.1 — SEO-friendly structure, especially Country and Learning Hub content.** These pages *are* the long-term asset (§4.4). Server-rendered HTML is indexable without a rendering budget or a prerender service.
- **§7 — excellent mobile experience; most users discover Waylen on a phone.** The homepage ships ~36 KB of CSS and ~3 KB of JS. An SPA would ship a framework before rendering a word.

The portal is form-driven — upload, review, book, message. Forms are what HTML
is for. Progressive enhancement covers the rest.

---

## 2. Request lifecycle

```
                          ┌──────────────────────────────┐
 request ───────────────► │ helmet · compression         │
                          │ body parsers · rate limit    │
                          └──────────────┬───────────────┘
                                         ▼
                          ┌──────────────────────────────┐
                          │ express.static (public/)     │  uploads NOT here
                          └──────────────┬───────────────┘
                                         ▼
                          ┌──────────────────────────────┐
                          │ session (Postgres) → flash   │
                          │ → CSRF → view locals         │
                          └──────────────┬───────────────┘
                                         ▼
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
 /webhooks/*                      loadCurrentUser                    /healthz
 signature-verified                attaches req.currentUser
 session-free, raw body                  │
                                         ▼
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              /portal/*              /admin/*            public routes
       requireAuth + Student    requireStaff + role        anonymous
                    │                    │                    │
                    └────────────────────┼────────────────────┘
                                         ▼
                              notFound → errorHandler
```

Two ordering decisions carry weight:

- **Webhooks mount before the session middleware.** A payment provider has no cookie and no CSRF token; it authenticates by signature over the *raw* body. Parsing that body as JSON first would destroy the signature.
- **Public routes mount last.** They own catch-all slugs (`/countries/:slug`), so `/portal` and `/admin` must claim their prefixes first.

---

## 3. Layering

```
routes/       →  URL to controller. No logic.
controllers/  →  parse & validate input, call one service, choose a view.
services/     →  business rules, transactions, notifications, audit.
models/       →  queries. Field selection, scoping, pagination.
prisma        →  persistence.
```

**Controllers never touch `prisma` directly.** Three things depend on this:

1. **Institution privacy (PRD §4.2).** Institution names must not appear publicly — it protects Waylen's position as intermediary. `listPublishedOpportunities` selects an explicit field list that omits `institutionId`, so a template cannot render what was never fetched. A controller reaching for `prisma.opportunity.findMany({ include: { institution: true } })` would silently break this.
2. **Counsellor scoping (PRD §5.4).** "A counsellor sees only their assigned students" is one `where` clause, defined once in `staffVisibilityFilter`. Retyped per controller, it would eventually be forgotten in one.
3. **Reviewable queries.** Schema indexes are chosen against the queries in `src/models`. Scattered queries make that impossible to audit.

Services are free of Express types on purpose: it makes them unit-testable, and
it means a future JSON API (Phase 4 native apps) reuses them unchanged.

---

## 4. Data model notes

Full schema with inline PRD references: [`../prisma/schema.prisma`](../prisma/schema.prisma).

### Partner and Referral exist from day one

PRD §6.3 is explicit, and it is the single biggest structural decision in the
schema. `Partner` covers all ten §6.1 categories including `INSTITUTION`, so:

- an opportunity's real institution is a `Partner` (private);
- an insurance sale writes a `Referral` with `sourceContext: 'portal.insurance'`;
- commission reconciliation has somewhere to live before any partner is signed.

Retrofitting this later would mean migrating live student records.

### The progress tracker is derived, not stored

`Application.stage` is the current stage; `ApplicationEvent` is an append-only
timeline. `buildProgress()` derives the seven-step display from the events, so
"when did this student reach Offer Received" is answerable rather than
overwritten.

`StudentProfile.currentStage` denormalises the student's **furthest-along**
application — it keeps admin list queries cheap, and one application slipping
back does not drag the profile with it. All three are written in one transaction
in `applicationService.changeStage`.

### Money

Every amount is an `Int` in minor units. There is no `Float` or `Decimal` in the
schema and there should never be one. `formatMoney` is the only place it becomes
a display string.

Invoice numbers are sequential and gap-free, so the sequence is allocated
*inside* the same transaction as the insert (`billingService.createInvoice`).
Accounting reviews expect no gaps.

### Documents flow in both directions

One table, split by `isIssuedByWaylen`:

- **false** — student uploads, enter the review queue, get approved or sent back.
- **true** — Waylen issues offer letters, acceptance letters, visa support letters onto a student's file at any stage, pre-approved, and the student is notified automatically. This is the "key operational requirement" in PRD §5.4.

`STUDENT_UPLOAD_DOCUMENT_TYPES` and `WAYLEN_ISSUED_DOCUMENT_TYPES` are disjoint
sets, enforced by validators and covered by a test — a student cannot upload
their own "acceptance letter".

---

## 5. Security decisions

### Documents

Encrypted with AES-256-GCM before anything is written. GCM is *authenticated*:
a tampered file fails on read rather than decrypting to garbage. Each file gets
a fresh IV, so two students uploading the same document produce different
ciphertext.

Storage keys are opaque UUIDs sharded by student, and files live outside the
static root. Reads go through a controller that checks access first and sets
`Cache-Control: private, no-store`. `express.static` is never pointed at them.

### The audit trail

`AuditLog` is append-only. `auditService` exposes `record`, `recordUpdate`,
`listForStudent` and `list` — there is deliberately no `update` or `delete`. An
audit log that can be edited is not an audit log.

`recordUpdate` stores only changed fields, so a form posting back forty
unchanged values does not produce forty lines of noise. Sensitive keys are
redacted before the write, not just at the logger.

### RBAC fails closed

`staffVisibilityFilter` returns `{ id: '__none__' }` for an unrecognised role —
matching nothing rather than everything. `requireRole` uses an explicit
allow-list. `assertCanAccessStudent` re-checks per record, because route-level
role checks cannot express "their own students".

### Error mapping

`errorHandler` normalises third-party errors (CSRF rejections, upload limits,
malformed bodies) onto our own hierarchy before deciding a status. Two reasons:
a rejected CSRF token is the user's problem, not a 500 claiming we broke; and
expected client errors logged at `error` level would bury real bugs.

---

## 6. Things that will need attention

Ordered by when they will bite.

### Before a second instance

- **Sessions** are Postgres-backed and fine, but **rate limits are per-process** (`express-rate-limit` default store). Two replicas means double the effective limit. Move to Redis.
- **Scheduled jobs run in-process** via `setInterval`. N replicas means N executions of the reminder sweep — students would get duplicate emails. Add a Postgres advisory-lock guard or move to an external scheduler. Flagged inline in `src/jobs/index.ts`.

### Before launch

- **S3 driver is a stub.** Local disk is fine for development; production needs object storage with versioning and lifecycle rules.
- **Payment webhooks verify signatures but do not yet process events.** They must be idempotent — providers deliver more than once.
- **Microsoft Graph client is a stub** that issues placeholder Teams links in development. Appointment confirmation already degrades gracefully when it fails, so this is not blocking.
- **Availability is a fixed working pattern**, not real counsellor calendars. Fine for launch; replace with Graph free/busy in Phase 2.

### Known simplifications

- **The CMS edits raw HTML.** Resource and country bodies are rendered with `<%- %>`. That is XSS-by-design for trusted staff authors — acceptable while only Waylen staff can write content, but it must be sanitised or moved to a structured editor before any external author gets access.
- **Search is `ILIKE`.** Adequate to a few thousand rows. Move to Postgres full-text (`tsvector`) when the Learning Hub grows.
- **No image pipeline yet.** `sharp` is installed but unused; uploads are served at original size. Add resizing before the photography-heavy pages ship (PRD §7 wants editorial-standard imagery *and* fast loading).

---

## 7. Testing

`tests/unit` covers pure logic — formatting, crypto, validators, stage ordering.
No database, fast, run on every change.

`tests/integration` mounts the real app with supertest. `createApp()` is
exported without listening precisely for this. The current suite covers what
needs no database: rendering, access-control redirects, CSRF rejection, feature
gating.

The database-backed cases that matter most are listed in
[`../tests/integration/README.md`](../tests/integration/README.md), ordered by
how much damage a regression would do. The top three:

1. A counsellor cannot open a student who is not assigned to them.
2. No public response contains an institution name.
3. Student A cannot download student B's document, even with a valid session and a guessed id.

Two bugs were caught by writing the smoke suite, both now regression-tested:
view locals not defaulting `currentUser` (EJS throws on unset locals), and
`flashMiddleware` marking every session dirty — which would have written a
session row to Postgres for every anonymous visitor to the public site.
