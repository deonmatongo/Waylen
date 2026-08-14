# Integration tests

These exercise real HTTP requests against the Express app with a real
PostgreSQL database. They are the tests that catch the failures unit tests
cannot: route wiring, middleware order, RBAC and session behaviour.

## Setup

```bash
createdb waylen_test
TEST_DATABASE_URL=postgresql://localhost:5432/waylen_test npx prisma migrate deploy
```

Then set `TEST_DATABASE_URL` in `.env`. `tests/setup.ts` redirects
`DATABASE_URL` to it, so a misconfigured run cannot touch development data.

## What to cover first

Ordered by how much damage a regression would do:

1. **Access control** — an anonymous request to `/portal` and `/admin`
   redirects or 403s; a STUDENT cannot reach `/admin`; a COUNSELLOR cannot
   open a student who is not assigned to them (see `assertCanAccessStudent`).
2. **Institution privacy (PRD §4.2)** — no public opportunity response
   contains an institution name or `institutionId`.
3. **Document isolation** — student A cannot download student B's document,
   even with a valid session and a guessed id.
4. **Registration and verification** — portal access stays closed until the
   email is verified.
5. **CSRF** — a POST without a valid token is rejected.
6. **Stage transitions** — `applicationService.changeStage` writes the
   application, the timeline event and the profile rollup atomically, and
   notifies the student.

Use `supertest` against `createApp()` — it is exported without listening
precisely so tests can mount it directly.
