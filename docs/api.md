# Mobile JSON API

Base path `/api/v1`. Student endpoints live under `/portal` and need
`Authorization: Bearer <access token>` for a STUDENT account (see
`src/routes/api/auth.routes.ts` for sign-in and refresh). All data is scoped to
the signed-in student.

Errors are JSON: `{ "error": "message", "details": { field: [msgs] } }` with
400 (validation), 401, 403, 404 or 5xx.

## Pagination

Every list takes `?page=1&perPage=20` (`perPage` is clamped to 50) and returns
`{ items, page, perPage, total }`. Two endpoints used to return a bare array,
and still do unless `page` or `perPage` is sent: `GET /applications` and
`GET /notifications` (the total is always in the `X-Total-Count` header).
`/documents`, `/appointments` and `/webinars` keep their original keys
(`documents`/`outstanding`, `upcoming`/`past`, `upcoming`/`recordings`) next to
the envelope.

## Endpoints (all prefixed `/portal`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/dashboard` | |
| GET | `/applications`, `/applications/:id` | |
| GET | `/documents` | Student uploads + outstanding requirements |
| POST | `/documents` | multipart: `document` file, `type`, optional `applicationId` |
| GET | `/documents/:id/download` | |
| GET | `/downloads`, `/downloads/:id/download` | Documents issued by Waylen |
| GET | `/contracts`, `/contracts/:id/download` | `?download=1` forces attachment |
| GET | `/appointments`, `/appointments/slots` | |
| POST | `/appointments` | `{ type, startsAt, format?, notes? }` |
| POST | `/appointments/:id/cancel` | |
| GET / PATCH | `/profile` | PATCH allow-list: `fullName, phone, city, preferredStudyLevel, preferredCourses, preferredDestinations` (country slugs) |
| GET | `/notifications` | |
| POST | `/notifications/read-all`, `/notifications/:id/read` | |
| GET | `/invoices` | Includes `summary` (outstanding balance). Needs `FEATURE_PAYMENTS` |
| GET | `/invoices/:id` | |
| POST | `/invoices/:id/pay` | Returns `{ checkoutUrl }`; 503 if the gateway is not configured |
| GET | `/messages/threads`, `/messages/threads/:id`, `/messages/unread-count` | |
| POST | `/messages/threads` | `{ subject, body }` |
| POST | `/messages/threads/:id/reply` | `{ body }` |
| GET / POST | `/support/tickets` | POST: `{ category, subject, body }` |
| GET | `/support/tickets/:id` | |
| POST | `/support/tickets/:id/reply` | `{ body }` |
| GET | `/services` | `{ package, included, additional }` |
| GET | `/resources`, `/resources/:slug` | `?type=` |
| GET | `/webinars` | |
| POST | `/webinars/:id/register` | |
