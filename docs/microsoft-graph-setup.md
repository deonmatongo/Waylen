# Connecting real Outlook/Microsoft calendar availability

The consultation-booking flow already supports reading real free/busy time from
an Outlook calendar and creating a real Teams meeting when a booking is
confirmed — for both the public "Book a free consultation" page and the
portal's appointment flow (they share the same booking logic). This is not a
coding task; it's an Azure AD app registration plus four environment
variables. Until they're set, the platform runs in a fallback mode: bookings
are "requested, then confirmed by staff" and meeting links are placeholders.

## 1. Register an app in Azure AD

1. Go to the [Azure Portal](https://portal.azure.com) → **Azure Active
   Directory** → **App registrations** → **New registration**.
2. Give it a name (e.g. "Waylen Booking Integration"). Leave the redirect URI
   blank — this is an app-only integration with no user sign-in.
3. After creation, note down from the **Overview** page:
   - **Application (client) ID** → `MS_GRAPH_CLIENT_ID`
   - **Directory (tenant) ID** → `MS_GRAPH_TENANT_ID`

## 2. Create a client secret

1. In the app registration, go to **Certificates & secrets** → **New client
   secret**.
2. Copy the secret **value** immediately (it's hidden after you navigate
   away) → `MS_GRAPH_CLIENT_SECRET`.

## 3. Grant API permissions (application, not delegated)

1. Go to **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Application permissions** (not "Delegated permissions" — this app talks
   to Graph on its own, with no user signed in).
2. Add:
   - `Calendars.ReadWrite` — read free/busy and create the booked event
   - `OnlineMeetings.ReadWrite` — create the Teams meeting link
3. Click **Grant admin consent** for your organisation. Without this step
   every Graph call will fail with a permissions error.

## 4. Point it at the right mailbox

`MS_GRAPH_ORGANISER_UPN` is the mailbox that gets checked for availability and
booked into — e.g. `you@yourcompany.com`. It must be a real, licensed mailbox
in the same Microsoft 365 tenant as the app registration above.

## 5. Set the environment variables

Add these four (already documented in `.env.example`) to your `.env` file
locally, and to your hosting platform's environment variables in production:

```
MS_GRAPH_TENANT_ID=<Directory (tenant) ID>
MS_GRAPH_CLIENT_ID=<Application (client) ID>
MS_GRAPH_CLIENT_SECRET=<client secret value>
MS_GRAPH_ORGANISER_UPN=you@yourcompany.com
MS_GRAPH_TIMEZONE=UTC
```

Restart the server. On boot, a log line will say whether Microsoft Graph is
configured — see `getApp()` in `src/server.ts`.

## What happens once this is set

- The booking form (`/book-consultation`) will only ever offer times that are
  actually free on that Outlook calendar.
- A guest booking a slot is instantly confirmed (no staff step) and a real
  Teams meeting is created and emailed via the calendar invite.
- Student appointments booked through the portal go through the same
  availability check, so staff never double-book against the real calendar
  even though those still go through the normal staff-confirmation step.

## If you later need more than one counsellor's own calendar

This setup uses one Azure app with app-only permissions against one fixed
mailbox (`MS_GRAPH_ORGANISER_UPN`). That fits a single organiser cleanly. If
Waylen later grows to multiple counsellors who each want their *own* separate
Outlook calendar connected, that needs a different auth model (delegated
OAuth, where each counsellor signs in once and grants access) — a follow-up
piece of work, not something the current four env vars can do.
