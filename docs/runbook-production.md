# Production runbook

Applies to the Vercel + Postgres (Supabase pooler) deployment.
`DATABASE_URL` is the pooled URL (runtime; include `connection_limit=1`).
`DIRECT_URL` is the session-mode/direct URL (migrations, `pg_dump`).

Never paste real connection strings or keys into tickets or chat.

## 1. Backups

Take a backup before every migration and on a schedule (enable the
provider's point-in-time recovery as well).

```bash
pg_dump "$DIRECT_URL" --format=custom --no-owner --no-privileges \
  --file="waylen-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Store dumps encrypted, off the production account. Keep at least 30 days.

### Restore drill (do this quarterly, never against production)

```bash
createdb waylen_restore_test            # a scratch database or a throwaway project
pg_restore --no-owner --no-privileges --dbname=waylen_restore_test waylen-<stamp>.dump
psql waylen_restore_test -c 'SELECT count(*) FROM users;'
psql waylen_restore_test -c 'SELECT count(*) FROM invoices;'
dropdb waylen_restore_test
```

A backup that has not been restored is not a backup. Record the date, the
dump size and the restore duration after each drill.

## 2. Migrations

1. Back up (section 1).
2. Review the SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`.
   Hand-written migrations must match `schema.prisma` exactly.
3. Apply against production only, from a trusted shell, with `DIRECT_URL` set:
   ```bash
   npx prisma migrate status
   npx prisma migrate deploy
   ```
4. Deploy the application code after the migration succeeds (migrations are
   additive-first so the previous build keeps working during the window).
5. Never run `prisma migrate dev` or `migrate reset` against a hosted DB.

## 3. Key backup

`DOCUMENT_ENCRYPTION_KEY` encrypts stored documents (AES-256-GCM) and, via
`encryptSecret`, MFA secrets. **Losing it makes every encrypted document and
secret unrecoverable.**

- Keep a copy in a password manager / secrets vault that is separate from the
  Vercel project and from the database backups.
- Do not store the key next to the dumps.
- Rotating the key requires re-encrypting every stored object; do not change
  it casually.

Also keep `SESSION_SECRET`/`JWT` secrets and `CRON_SECRET` in the vault
(these can be rotated; rotation signs everyone out).

## 4. Scheduled retention

`GET /cron/retention` (bearer `CRON_SECRET`) deletes expired/revoked
sessions and refresh tokens older than 30 days, clears expired verification
and reset tokens, deletes read notifications older than 180 days and audit
logs older than `RETENTION_AUDIT_DAYS` (default 730). It is batched and
idempotent; run it daily at 03:00 UTC.

## 5. Data-subject requests

- Export: `privacyService.exportUserData(userId)` (portal "Download my data").
- Erasure: `privacyService.anonymiseUser(userId, actorId)` anonymises PII,
  archives the account and revokes sessions. Invoices and payments are kept
  (legal retention). There is no hard delete.

## 6. Finding dummy accounts and placeholder content (read-only)

Run these in a read-only SQL session before and after cleanup.

```sql
-- Demo / placeholder accounts
SELECT id, email, role, status, "createdAt" FROM users
WHERE email IN ('admin@waylen.com','counselor@waylen.com','student@waylen.com')
   OR email LIKE '%@waylen.example'
   OR email LIKE '%@example.com'
ORDER BY email;

-- Placeholder partners
SELECT id, slug, name, status FROM partners
WHERE slug IN ('europa-student-cover','meridian-immigration-law','atlas-education-finance',
               'partner-school-warsaw','partner-school-dublin');

-- Placeholder testimonials
SELECT id, "authorName", status FROM testimonials
WHERE "authorName" IN ('Chiedza M.','Kwame A.','Amara O.');

-- Placeholder webinars
SELECT id, slug, title FROM webinars
WHERE slug IN ('how-to-study-in-poland','scholarship-opportunities-in-ireland',
               'building-wealth-as-an-african-professional-abroad','choosing-between-canada-and-the-eu');

-- Placeholder resources
SELECT id, slug FROM resources WHERE body LIKE '%seeded development content%';

-- Seed invoices (check who owns them before concluding they are dummy)
SELECT i.id, i.number, i.status, u.email
FROM invoices i
JOIN student_profiles sp ON sp.id = i."studentProfileId"
JOIN users u ON u.id = sp."userId"
WHERE i.number ~ '^INV-[0-9]{4}-0000[12]$';

-- Placeholder contact settings
SELECT key, value FROM settings
WHERE value LIKE '%example%' OR value LIKE '+353 % 000 0000';
```

Table names follow the `@@map` names in `schema.prisma`; confirm with `\dt`
if unsure.

## 7. Removing dummy data

`prisma/cleanup-dummy-data.ts` is dry-run by default.

```bash
# 1. Back up (section 1), then dry run. Prints counts and what WOULD be deleted.
npx tsx prisma/cleanup-dummy-data.ts

# 2. Optionally include integration-test users (<run-id>-<13 digit ts>@example.com).
npx tsx prisma/cleanup-dummy-data.ts --include-test-users

# 3. Commit. Requires the host of DATABASE_URL as confirmation.
CONFIRM_DB_HOST=<host of DATABASE_URL> \
  npx tsx prisma/cleanup-dummy-data.ts --commit
```

Properties: exact-match emails/slugs/names only (no bare `example.com`
wildcard); one transaction in FK-safe order; every delete count must match the
planned count or the whole transaction rolls back; aborts if a real student
refers to a dummy partner. Invoices are deleted only if they belong to a
dummy student. Re-run the section 6 queries afterwards.

Suggested package.json scripts:

```json
"db:cleanup-dummy": "tsx prisma/cleanup-dummy-data.ts",
"jobs:retention": "curl -fsS -H \"Authorization: Bearer $CRON_SECRET\" \"$APP_URL/cron/retention\""
```
