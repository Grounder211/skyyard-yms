# Carrier booking requests + drag-to-schedule sidebar

## Problem

Carriers currently self-book an exact appointment slot through a public, unauthenticated link (`/book/:token` → `BookingPage.tsx`), picking their own date, time, and dock from live availability. The admin has no say in placement before it's booked.

The desired flow is the reverse: a carrier submits what they need (vehicle, driver identity, cargo) without picking a time, and the admin places it on the calendar by dragging the request onto a slot. When a slot is assigned or later moved, the carrier is notified.

## Scope

- Carrier Portal gains a "Request a booking" form.
- Calendar page gains a request sidebar (Day/Week views) with drag-to-schedule.
- Dragging an already-scheduled appointment to a new slot reschedules it and notifies the carrier of the change.
- Booking-confirmed and booking-swapped notifications go through the existing notification queue, targeting the carrier's email.
- The old public self-service picker (`/book/:token`) is hidden, not deleted — same treatment as Dispatch/Pipeline/Exceptions/etc. earlier this session (entry removed from `HIDDEN_ROUTES`-equivalent gating, code stays in the repo).

Out of scope: an actual email provider integration (SendGrid credentials only added by the user later — this spec builds the full send path against the existing queue, which already fails honestly without a provider, same as SMS without Twilio); changing the Month/List calendar views to support drag; multi-facility booking requests (single facility, matching the rest of this session's scope).

## Data model

No new table. A booking request **is** an `appointments` row with `status = 'REQUESTED'` and `start_time` / `end_time` / `dock_id` left `null` (all three are already nullable). Assigning a slot is an update, not a new record — the appointment keeps its identity, its health-status logic, its no-show detection, and its driver linkage exactly as they already work for every other appointment.

New columns on `appointments` (mirroring the fields already added to `walkin_registrations` for gate check-in, so the vocabulary is consistent end to end):

| Column | Type | Notes |
|---|---|---|
| `personal_id_number` | text | Required on request submission. |
| `cargo_type` | text | One of: Pallets, Boxes, Shipping container, Other. |
| `cargo_quantity` | text | Free text (e.g. "24"), shown only once a cargo type is picked — same UX as the gate check-in form. |

`status` gains one new value: `REQUESTED` (existing values — `SCHEDULED`, `CHECKED_IN`, `CANCELLED`, etc. — are unchanged). A `REQUESTED` row is excluded from every query that currently filters `!= CANCELLED` and expects a real time (no-show detection, capacity forecast, the Calendar's own rendering) by additionally filtering `!= REQUESTED` wherever "real, timed appointments" is the intent — audited as part of implementation, not blanket-changed, since some read paths (e.g. a facility-wide count of "bookings on the books") may legitimately want to include them.

## Carrier Portal: request form

New section in `CarrierPortal.tsx`, visible without needing a specific appointment to already exist. Fields: plate, personal identity number, cargo type (select) + quantity (text, appears once a type is chosen), load type, preferred date (a hint for the admin, not a commitment — stored on the row but not treated as `start_time`). Submits to a new endpoint, creates the `REQUESTED` appointment tied to `req.session.carrier_id`.

The public `/book/:token` route and `BookingPage.tsx` are hidden from navigation but not deleted, matching how Dispatch/Pipeline/Exceptions/Documents/Network/Financials/Design System were switched off earlier — reversible by removing one entry, not a rewrite.

## Calendar: request sidebar + drag-to-schedule

A collapsible sidebar panel alongside the Day/Week views (not Month/List — those have no hour grid to drop onto; a request there falls back to a plain "click to open the assign dialog" action instead of drag). Each pending request renders as a card: plate, carrier name, cargo type + quantity, personal ID number, requested date if given.

**Drag a request card onto an hour cell:**
1. A confirm popover opens at the drop point showing the target day/time, the plate, and the dock the slot-scoring engine (`scoreSlot`, the same one `BookingPage.tsx` already uses for its recommendations) picked automatically, with a dropdown to override it.
2. Confirming calls the assignment endpoint: sets `start_time`/`end_time` (duration from `estimateDurationMinutes`, the same helper used elsewhere), `dock_id`, flips `status` to `SCHEDULED`, and queues a "booking confirmed" notification to the carrier.
3. Canceling the popover reverts the drag; nothing is written.

**Drag an existing scheduled appointment to a different cell:**
Same popover pattern, phrased as a reschedule ("Move ABC123 from 10:00 to 14:00?"). Confirming updates `start_time`/`end_time` only (dock stays unless the admin also changes it) and queues a "booking swapped" notification carrying the old and new time. This is a dedicated endpoint, not the general-purpose `PATCH /api/appointments/:id` — so the notification fires only when a drag actually changes the time, never on unrelated field edits from the existing edit modal.

Both interactions are built on `@dnd-kit` (new dependency — small, accessible, actively maintained) rather than native HTML5 drag events, for real drag feedback: the card lifts and follows the cursor, valid hour cells highlight on drag-over, invalid ones don't.

## Notifications

Both "booking confirmed" and "booking swapped" go through the existing `notify()` function and `notifications_queue`, addressed to `carrier.email` (an existing column, not previously used as a notification target anywhere in this codebase — every prior `notify()` call has only ever passed a phone number). In-app notifications work immediately with no setup. Email queues correctly and fails honestly with a clear error until real provider credentials are added — the same pattern already in place for SMS without Twilio configured, not a new gap this feature introduces.

Provider choice for when the user is ready: **SendGrid** — single API key (matches how Twilio and Mapbox are already configured in this codebase), free tier, no mail server to run. Wiring the queue processor's `email` branch to call it is a small, isolated change once a key exists; not built against a live account in this pass.

## Error handling

- Assigning a slot the scoring engine picks that's since been taken by a real conflict: same "spot was taken while you were deciding" pattern already used for the gate approval's manual-spot race condition — reject with a clear message, don't silently double-book.
- A request with no `personal_id_number` or `cargo_type` cannot be submitted — enforced client- and server-side, mirroring the gate check-in form's validation.
- A carrier without an `email` on file: the notification still queues (nothing crashes), it just has nowhere to be delivered — surfaced honestly in the queue's failure state rather than skipped silently, consistent with how a missing phone number is already handled.

## Testing

- Pure logic (dock auto-pick fallback, duration calculation reuse, status-transition validity) gets unit tests the same way `resolveDockAssignment` did for gate check-in — a small testable function, not logic buried inline in a route handler.
- Live verification in the browser: submit a request from Carrier Portal, drag it onto a Week-view slot, confirm the dock auto-pick and the "booking confirmed" notification row lands in the queue; then drag an existing appointment to a new slot and confirm the "booking swapped" notification carries the correct old/new time. Same discipline as every other feature this session — typecheck, full test suite, build, then real data in the browser before calling it done.
