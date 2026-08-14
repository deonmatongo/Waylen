# Models

The **M** in MVC. Prisma generates the persistence types from
[`prisma/schema.prisma`](../../prisma/schema.prisma); the files here add the
query layer on top of it.

## The rule

Controllers never call `prisma` directly. They call a repository here, or a
service in [`../services`](../services). This keeps three things true:

1. **Public views cannot leak private fields.** `Opportunity.institutionId` is
   the clearest case — PRD §4.2 requires institution names stay hidden from
   anonymous visitors. The public selectors in `content.model.ts` enumerate
   fields explicitly and omit it, so a template cannot render what was never
   fetched.
2. **Counsellor scoping is enforced in one place.** A counsellor sees only
   their assigned students. That `where` clause is `staffVisibilityFilter` in
   `student.model.ts`, defined once rather than retyped per controller.
3. **Query shapes stay reviewable.** The indexes in the schema were chosen
   against the queries in these files.

## Current state

Three repositories exist, covering the reads where field selection or scoping
carries a correctness requirement:

| File | Covers |
| --- | --- |
| `content.model.ts` | Countries, opportunities, resources, FAQs, testimonials, partner logos |
| `student.model.ts` | Student profiles, counsellor scoping, stage rollups, counsellor list |
| `webinar.model.ts` | Webinars, recordings, remaining capacity |

Everything else queries through a service in [`../services`](../services) —
`applicationService`, `documentService`, `billingService`, `referralService`,
`enquiryService`, `reportService`, `auditService`. Those own transactional
writes, so their reads live alongside them rather than being split across two
layers.

### When to extract a new repository here

Add one when a read is **shared by more than one service or controller**, or
when it has a **field-selection or scoping rule that must not be re-derived** —
those are the cases where duplication turns into a privacy or access bug. A
one-off query used by a single service belongs in that service.

## Conventions

- Read methods return exactly the fields the caller needs — no `include: true`
  fan-out on list endpoints.
- Money is `Int` minor units everywhere. Never introduce a float.
- Anything that mutates a student record goes through a service, so the audit
  entry (PRD §8.2) and the notification are written in the same transaction.
- Multi-row writes that must not half-apply use `prisma.$transaction`.
