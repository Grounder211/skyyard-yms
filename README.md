<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# SkyYard YMS

A yard management system: gate check-in, walk-in registration, appointment scheduling, dispatch/move orders, live yard tracking, carrier/driver self-service portals, financials, and a superadmin network console.

## Run locally

**Prerequisites:** Node.js, and the SkyYard Supabase project's `service_role` key (see below).

1. Install dependencies:
   `npm install`
2. Create a `.env` file (copy `.env.example`) and add `SUPABASE_SERVICE_ROLE_KEY` — get it from
   [Project Settings → API](https://supabase.com/dashboard/project/wdghkrqyggydvbsuasst/settings/api)
   on the **skyyard-yms** Supabase project (region: eu-north-1 / Stockholm). Never commit the real value.
3. Run the app:
   `npm run dev`
4. Open `http://localhost:3000` and sign in with one of the seeded accounts below.

## Database

The database is a dedicated Supabase Postgres project (**skyyard-yms**, `eu-north-1`) — not the SQLite file this
project started with. 32 tables, full RLS (locked to the `service_role` key the Express server uses; anon/authenticated
get nothing), and four Postgres functions (`gate_checkin_tx`, `walkin_autoassign_tx`, `complete_move_tx`,
`dispatch_trailer_tx`) that keep multi-table writes atomic — Supabase's JS client doesn't have a client-side
multi-statement transaction primitive the way `better-sqlite3` did, so those specific operations run as a single
Postgres function call instead. Authorization stays in the Express layer (`requireRole(...)` in `server.ts`), not in
RLS policies — this app has staff, driver, and carrier accounts that don't map to Supabase Auth, so the server's
`service_role` key is the one trusted place all access checks happen, same pattern already used for the carrier/driver
login before this migration.

## Modules

- **Gate & Check-in** (`/gate`) — verify scheduled arrivals, register walk-ins with automatic parking assignment (or a real-time manager alert when the yard is full), manage on-site visitors, and scan a QR/reference code at the gate.
- **Live Tracking** (`/tracking`) — a "digital twin" of the yard: every occupied spot shows a live-ticking time-on-site counter, color-coded normal/approaching-limit/detention, plus a real-time gate activity feed and quick KPIs (trucks on site, avg. time on site, spots over the detention threshold).
- **Dispatch & Move Orders** (`/dispatch`) — move trailers between spots/docks and dispatch them off-site from a live yard map.
- **Driver portal** (`/driver`) — phone + SMS OTP sign-in for drivers to see their bookings and a QR code for gate check-in.
- **Carrier portal** (`/carrier`) — carrier login to track active trucks, today's appointments, and history.
- **Pre-booking page** (`/book/:token`) — public, tokenized link (generated via `POST /api/admin/carriers/:id/booking-link`) for a carrier to self-schedule a dock appointment.
- **Superadmin console** (`/superadmin`) — switch between facilities, manage the carrier/plate blacklist, and bulk-import appointments from CSV.
- **Settings** (`/settings`) — currency/locale, detention thresholds, an EN/SV language toggle, and the GDPR data-request queue.
- **Privacy request page** (`/privacy`) — public GDPR self-service form (access / deletion / correction).

## Roles & permissions

Enforced both server-side (`requireRole(...)` guards in `server.ts`) and mirrored in the UI (`src/lib/permissions.ts`) so nav items and routes match what the API actually allows:

| Role | Can do | Cannot do |
|---|---|---|
| **Guard** | Gate check-in, walk-in registration, visitor register/checkout, view live tracking & calendar | Dispatch/move trailers, financials, settings, superadmin |
| **Hostler** (yard mover / spotter) | Dispatch board — create & complete moves, dispatch trailers, view live tracking | Gate check-in, financials, settings, superadmin |
| **Admin** (facility manager) | Everything for their facility: gate, dispatch, calendar, financials, analytics, settings, dock rules, blacklist, bulk import | Switch facilities or see the cross-network superadmin view |
| **Superadmin** | Everything Admin can, plus switch between facilities and see network-wide stats | — |
| **Driver / Carrier** | Their own portal only (`/driver`, `/carrier`) — bookings, QR check-in code, balances | Any staff screen |

### Default staff logins (seeded in the database)

| Role | Email | Password |
|---|---|---|
| Superadmin | `superadmin@skyyard.se` | `Skyyard#2026` |
| Admin | `admin@skyyard.se` | `Skyyard#2026` |
| Guard | `guard@skyyard.se` | `Skyyard#2026` |
| Hostler | `hostler@skyyard.se` | `Skyyard#2026` |

Change these (update `password_hash` in the `users` table with a new bcrypt hash, or add a "change password" flow) before using this outside a demo.

## Still on the roadmap

- UI/UX polish pass (empty states, loading states, mobile responsiveness) across all pages.
- Real Postgres-level RLS policies if you ever add direct client-to-Supabase access (currently everything goes through the Express API, so this isn't required, just an option).
- Swap `console.error`/log lines for the `winston` logger that's already a dependency but not wired up.
