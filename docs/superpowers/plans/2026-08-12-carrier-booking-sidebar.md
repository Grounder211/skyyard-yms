# Carrier Booking Requests + Drag-to-Schedule Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carriers submit booking requests (vehicle, driver identity, cargo) from the Carrier Portal with no time chosen; admins drag each request onto a Day/Week calendar slot to schedule it, and dragging an existing scheduled appointment to a new slot reschedules it — both actions notify the carrier.

**Architecture:** No new table — a request is an `appointments` row with `status = 'REQUESTED'` and `start_time`/`end_time`/`dock_id` left null until an admin assigns them. Three new columns carry driver/cargo detail. New Express routes reuse the existing dock-scoring (`scoreSlot`), conflict-checking (`findDockConflict`), and duration-estimation (`estimateEndTime`) services rather than duplicating that logic. Drag-and-drop is `@dnd-kit/core` (new dependency) wired into the existing `AppointmentCalendar.tsx` Day/Week views.

**Tech Stack:** Express + Supabase (existing), React 19 + `@dnd-kit/core` (new), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-12-carrier-booking-sidebar-design.md`
- No new database table — reuse `appointments` with `status = 'REQUESTED'`.
- New columns: `personal_id_number text`, `cargo_type text`, `cargo_quantity text` on `appointments`.
- Cargo type options are exactly: `Pallets`, `Boxes`, `Shipping container`, `Other` (same list as the gate check-in cargo field already shipped this session).
- Drag-and-drop scoped to Day and Week calendar views only — Month/List are unaffected.
- Notifications go through the existing `notify()` function and `notifications_queue`, addressed to `carrier.email`. Email will not actually send until a real provider is configured later — that is expected, not a bug to fix here.
- The old public self-service picker (`/book/:token`, `BookingPage.tsx`) is hidden (link removed from Login), not deleted.
- Every task: typecheck (`npm run lint`), `npx vitest run`, `npm run build` before commit. Live-verify in the browser against real Supabase data before marking a task done, per this project's established discipline.

---

## File Structure

**Backend (all in the existing `server.ts` monolith, matching every other route in this codebase):**
- New routes: `POST /api/carrier/booking-requests`, `GET /api/admin/booking-requests`, `GET /api/admin/booking-slot-availability`, `POST /api/admin/booking-requests/:id/assign`, `POST /api/appointments/:id/reschedule`.
- Modified route: `GET /api/appointments` — exclude `REQUESTED` rows (they have no `start_time`, the Calendar can't position them).

**Frontend:**
- Modify `src/pages/CarrierPortal.tsx` — add the "Request a booking" form.
- Create `src/components/BookingRequestsSidebar.tsx` — lists pending requests as draggable cards.
- Create `src/components/BookingAssignPopover.tsx` — the confirm-and-pick-dock popover shown on drop (used for both new assignment and reschedule).
- Modify `src/components/AppointmentCalendar.tsx` — mount the sidebar, make Day/Week hour cells droppable, make existing appointment blocks draggable.
- Modify `src/pages/Login.tsx` — remove the "Carrier booking" link that points at the now-hidden `/book/:token`.
- `package.json` — add `@dnd-kit/core`.

---

### Task 1: Migration — new appointment columns

**Files:**
- None (Supabase migration, applied via the Supabase MCP `apply_migration` tool against project `wdghkrqyggydvbsuasst`)

**Interfaces:**
- Produces: `appointments.personal_id_number` (text, nullable), `appointments.cargo_type` (text, nullable), `appointments.cargo_quantity` (text, nullable) — consumed by every task below.

- [ ] **Step 1: Apply the migration**

```sql
alter table appointments add column if not exists personal_id_number text;
alter table appointments add column if not exists cargo_type text;
alter table appointments add column if not exists cargo_quantity text;
```

Run via the Supabase MCP `apply_migration` tool, name: `add_appointment_cargo_and_identity`, project_id `wdghkrqyggydvbsuasst`.

- [ ] **Step 2: Verify**

```sql
select column_name from information_schema.columns where table_name='appointments' and column_name in ('personal_id_number','cargo_type','cargo_quantity');
```

Expected: all three rows returned.

- [ ] **Step 3: Commit**

No file changes to commit for this task — proceed to Task 2 (migrations aren't tracked in this repo's git history, matching every other migration applied this session).

---

### Task 2: Carrier submits a booking request

**Files:**
- Modify: `server.ts` (add route after the existing `app.get("/api/carrier/detention", ...)` block — search for `app.post("/api/carrier/logout"` to find the carrier route cluster and insert nearby)
- Test: `server/services/bookingRequest.test.ts`
- Create: `server/services/bookingRequest.ts`

**Interfaces:**
- Produces: `validateBookingRequest(input: { plate?: string; personal_id_number?: string; cargo_type?: string; cargo_quantity?: string; load_type?: string }): { ok: true } | { ok: false; error: string }` — consumed by Task 2's route handler.
- Produces route: `POST /api/carrier/booking-requests` (requireCarrierAuth) — body `{ plate, personal_id_number, cargo_type, cargo_quantity, load_type }`, returns `{ success: true, id: number }`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/services/bookingRequest.test.ts
import { describe, it, expect } from "vitest";
import { validateBookingRequest } from "./bookingRequest";

describe("validateBookingRequest", () => {
  it("accepts a complete request", () => {
    const result = validateBookingRequest({ plate: "ABC123", personal_id_number: "19900101-1234", cargo_type: "Pallets", cargo_quantity: "24", load_type: "standard" });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a missing plate", () => {
    const result = validateBookingRequest({ personal_id_number: "19900101-1234", cargo_type: "Pallets" });
    expect(result).toEqual({ ok: false, error: "Vehicle plate is required" });
  });

  it("rejects a missing personal ID number", () => {
    const result = validateBookingRequest({ plate: "ABC123", cargo_type: "Pallets" });
    expect(result).toEqual({ ok: false, error: "Personal identity number is required" });
  });

  it("rejects a missing cargo type", () => {
    const result = validateBookingRequest({ plate: "ABC123", personal_id_number: "19900101-1234" });
    expect(result).toEqual({ ok: false, error: "Cargo type is required" });
  });

  it("rejects a cargo type outside the fixed list", () => {
    const result = validateBookingRequest({ plate: "ABC123", personal_id_number: "19900101-1234", cargo_type: "Freeform text" });
    expect(result).toEqual({ ok: false, error: "Invalid cargo type" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/bookingRequest.test.ts`
Expected: FAIL — `Cannot find module './bookingRequest'`

- [ ] **Step 3: Write the implementation**

```typescript
// server/services/bookingRequest.ts
export const CARGO_TYPES = ["Pallets", "Boxes", "Shipping container", "Other"] as const;

export interface BookingRequestInput {
  plate?: string;
  personal_id_number?: string;
  cargo_type?: string;
  cargo_quantity?: string;
  load_type?: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

// Same required-field shape as the gate check-in form (plate, personal ID,
// cargo type) — a carrier submitting a request on a driver's behalf needs
// to answer the same "who and what" questions a driver answers in person.
export function validateBookingRequest(input: BookingRequestInput): ValidationResult {
  if (!input.plate) return { ok: false, error: "Vehicle plate is required" };
  if (!input.personal_id_number) return { ok: false, error: "Personal identity number is required" };
  if (!input.cargo_type) return { ok: false, error: "Cargo type is required" };
  if (!(CARGO_TYPES as readonly string[]).includes(input.cargo_type)) return { ok: false, error: "Invalid cargo type" };
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/bookingRequest.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Add the route in server.ts**

Find `app.post("/api/carrier/logout"` in `server.ts` and insert this route directly after it:

```typescript
  // Carrier submits what they need (vehicle, driver identity, cargo) with
  // no time chosen — an admin places it on the calendar via drag-and-drop
  // (see /api/admin/booking-requests/:id/assign). This is an appointment
  // like any other, just with start_time/end_time/dock_id left null until
  // assigned — no parallel "requests" table.
  app.post("/api/carrier/booking-requests", requireCarrierAuth, async (req: any, res) => {
    const { plate, personal_id_number, cargo_type, cargo_quantity, load_type } = req.body;
    const validation = validateBookingRequest({ plate, personal_id_number, cargo_type, cargo_quantity, load_type });
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    try {
      const { data: carrier } = await db.from("carriers").select("id, name, email").eq("id", req.session.carrier_id).maybeSingle();
      if (!carrier) return res.status(401).json({ error: "Carrier session invalid" });

      const { data, error } = await db.from("appointments").insert({
        facility_id: req.facilityId || 1, plate: String(plate).toUpperCase(), carrier: carrier.name, carrier_id: carrier.id,
        load_type: load_type || "standard", personal_id_number, cargo_type, cargo_quantity: cargo_quantity || null,
        status: "REQUESTED",
      }).select("id").single();
      if (error) throw error;

      logAudit({ action: "BOOKING_REQUEST_SUBMITTED", entityType: "APPOINTMENT", entityId: String(data.id), details: { plate, carrier: carrier.name }, ip: req.ip, facility_id: req.facilityId || 1 });
      res.json({ success: true, id: data.id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
```

Add the import at the top of `server.ts`, next to the other `server/services` imports (e.g. after `import { resolveDockAssignment, ... } from "./server/services/dockAssignment.js";`):

```typescript
import { validateBookingRequest } from "./server/services/bookingRequest.js";
```

- [ ] **Step 6: Typecheck**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add server/services/bookingRequest.ts server/services/bookingRequest.test.ts server.ts
git commit -m "feat: carrier booking request submission endpoint"
```

---

### Task 3: Admin sees pending requests; Calendar stops choking on them

**Files:**
- Modify: `server.ts`

**Interfaces:**
- Produces route: `GET /api/admin/booking-requests` (requireRole superadmin/ADMIN/GUARD) — returns `Array<{ id, plate, carrier, personal_id_number, cargo_type, cargo_quantity, load_type, created_at }>`, oldest first.
- Modifies existing route: `GET /api/appointments` now excludes `status = 'REQUESTED'`.

- [ ] **Step 1: Add the admin listing route**

Find `app.get("/api/admin/walkin/pending"` in `server.ts` and insert this route directly after its closing `});`:

```typescript
  // Sidebar source for the Calendar's drag-to-schedule panel. Oldest
  // first — the admin naturally works the queue in submission order.
  app.get("/api/admin/booking-requests", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { data } = await db.from("appointments")
      .select("id, plate, carrier, personal_id_number, cargo_type, cargo_quantity, load_type, created_at")
      .eq("facility_id", req.facilityId).eq("status", "REQUESTED")
      .order("created_at", { ascending: true });
    res.json(data || []);
  });
```

- [ ] **Step 2: Exclude REQUESTED from the Calendar's own listing**

In `server.ts`, find:

```typescript
      let query = db.from("appointments").select("*, spots(name)").eq("facility_id", facilityId).neq("status", "CANCELLED");
```

Replace with:

```typescript
      // REQUESTED rows have no start_time yet — the Calendar positions
      // appointments by start_time, so one would render at the epoch or
      // crash the date parsing. They live in the booking-requests sidebar
      // instead, until an admin assigns them a slot.
      let query = db.from("appointments").select("*, spots(name)").eq("facility_id", facilityId).neq("status", "CANCELLED").neq("status", "REQUESTED");
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 4: Live-verify**

Restart the dev server (`server.ts` changed, no hot reload). Insert one test appointment via Supabase SQL:

```sql
insert into appointments (facility_id, plate, carrier, load_type, personal_id_number, cargo_type, cargo_quantity, status)
values (1, 'PLANTEST1', 'PlanTestCarrier', 'standard', '19900101-1234', 'Pallets', '10', 'REQUESTED');
```

Log in as admin, `fetch('/api/admin/booking-requests')` from the browser console (or via `javascript_tool`) — confirm the row appears. Then open `/calendar` and confirm this row does **not** appear anywhere on the grid (it has no `start_time`). Clean up: `delete from appointments where plate='PLANTEST1';`

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat: list pending booking requests; exclude them from the timed calendar view"
```

---

### Task 4: Single-slot dock availability (powers the assign popover)

**Files:**
- Modify: `server.ts`

**Interfaces:**
- Consumes: `scoreSlot(slot: { dock_id: number; start_time: string }, params: { equipmentType: string; carrierId?: string; facilityId: number; date: string }): Promise<{ score: number; recommended: boolean; reason: string }>` (existing, `server/services/slotEngine.ts`)
- Consumes: `estimateEndTime(startTimeIso: string, loadType?: string | null, loadWeightKg?: number | null): string` (existing, `server/services/appointmentDuration.ts`)
- Consumes: `findDockConflict(candidate: { dock_id: number | null; start_time: string; end_time: string; load_type: string | null }, existing: DockApptWindow[], allowedEquipmentTypes: string[] | null): { reason: string } | null` (existing, `server/services/dockConflict.ts`)
- Produces route: `GET /api/admin/booking-slot-availability?start_time=<ISO>&load_type=<string>&carrier_id=<number?>` — returns `Array<{ dockId: number; dockName: string; score: number; available: boolean; conflictReason: string | null }>`, sorted best-first.

- [ ] **Step 1: Add the route**

The existing `/api/slots/recommend` (search for `app.get("/api/slots/recommend"` in `server.ts`) scores every dock against a *fixed list* of business-hour times — it can't answer "is dock X free at this exact arbitrary time the admin just dropped onto". This route does the same scoring for one specific time instead. Insert it directly after the `/api/slots/recommend` handler's closing `});`:

```typescript
  // The assign popover needs "which docks are free, and best, at exactly
  // the time just dropped onto" — /api/slots/recommend only scores a fixed
  // list of business-hour times, not an arbitrary drop target. Same
  // scoring/conflict logic, one specific time instead of nine.
  app.get("/api/admin/booking-slot-availability", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { start_time, load_type, carrier_id } = req.query;
    const facilityId = req.facilityId;
    if (!start_time) return res.status(400).json({ error: "start_time is required" });

    try {
      const endTime = estimateEndTime(start_time as string, load_type as string, undefined);
      const date = (start_time as string).slice(0, 10);
      const { data: docks } = await db.from("spots").select("id, name").eq("type", "DOCK").eq("facility_id", facilityId);
      const { data: dayAppointments } = await db
        .from("appointments")
        .select("dock_id, start_time, end_time, load_type, load_weight_kg, status")
        .eq("facility_id", facilityId)
        .neq("status", "CANCELLED")
        .gte("start_time", `${date}T00:00:00`)
        .lte("start_time", `${date}T23:59:59`);
      const { data: dockRules } = await db.from("dock_rules").select("dock_door_id, allowed_equipment_types").eq("facility_id", facilityId);
      const ruleMap = new Map((dockRules || []).map((r: any) => [r.dock_door_id, r.allowed_equipment_types]));

      const results = await Promise.all((docks || []).map(async (d: any) => {
        const conflict = findDockConflict(
          { dock_id: d.id, start_time: start_time as string, end_time: endTime, load_type: (load_type as string) || null },
          (dayAppointments || []) as any,
          ruleMap.get(d.id) || null
        );
        const scored = await scoreSlot({ dock_id: d.id, start_time: start_time as string }, {
          equipmentType: (load_type as string) || "standard", carrierId: carrier_id as string | undefined, facilityId, date,
        });
        return { dockId: d.id, dockName: d.name, score: scored.score, available: !conflict, conflictReason: conflict?.reason || null };
      }));

      results.sort((a, b) => (a.available === b.available ? b.score - a.score : a.available ? -1 : 1));
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
```

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 3: Live-verify**

Restart the dev server. As admin, from the browser console:

```javascript
fetch('/api/admin/booking-slot-availability?start_time=' + encodeURIComponent(new Date(Date.now() + 3600_000).toISOString()) + '&load_type=standard').then(r => r.json())
```

Expected: an array of every DOCK spot with `available: true` and a `score`, sorted best-first (empty yard, so all available).

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: single-slot dock availability endpoint for the assign popover"
```

---

### Task 5: Assign a booking request to a slot

**Files:**
- Modify: `server.ts`

**Interfaces:**
- Produces route: `POST /api/admin/booking-requests/:id/assign` (requireRole superadmin/ADMIN/GUARD) — body `{ start_time: string; dock_id: number }`, returns `{ success: true }` or `409 { error }` on conflict.
- Modifies: the existing `notify()` closure (server.ts:468) gains an optional `forceEmail` param.

**Why Step 1 below is necessary:** `notify()` (server.ts:468-511) looks up `notification_preferences` by `(user_id, user_type, event_type)` and defaults to `{ channel_sms: 1, channel_email: 0, channel_inapp: true }` when no row exists. `recipientType: "CARRIER"` (the existing convention in this file — e.g. `DETENTION_DISPUTE_RESOLVED`, `VEHICLE_INSPECTION_EXPIRING`) has never had a `notification_preferences` row seeded for it, so no preference row will ever exist for it — meaning `prefs.channel_email` stays `0` and the email branch (`if (prefs.channel_email && data.email)`) never fires, silently dropping the booking-confirmed email even though `data.email` is populated. Since the user explicitly requires this email and there's no admin UI anywhere in this app for carriers to manage notification preferences, the correct fix is a per-call opt-in override, not a global default change (which would also turn on email for every other existing recipient type/event that relies on the SMS-only default).

- [ ] **Step 1: Add a `forceEmail` override to `notify()`**

In `server.ts`, find:

```typescript
  const notify = async ({ type, recipientType, recipientId, data }: any) => {
```

Replace with:

```typescript
  const notify = async ({ type, recipientType, recipientId, data, forceEmail }: any) => {
```

Then find:

```typescript
      if (prefs.channel_email && data.email) {
```

Replace with:

```typescript
      if ((prefs.channel_email || forceEmail) && data.email) {
```

- [ ] **Step 2: Add the route**

Insert directly after the `/api/admin/booking-slot-availability` route added in Task 4:

```typescript
  // Confirming the assign popover — the popover already showed the admin
  // a ranked, conflict-checked dock list (booking-slot-availability), so
  // this re-checks the one chosen dock is still free (it may not be, if
  // someone else assigned it in the meantime) and commits.
  app.post("/api/admin/booking-requests/:id/assign", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { start_time, dock_id } = req.body;
    const facilityId = req.facilityId;
    if (!start_time || !dock_id) return res.status(400).json({ error: "start_time and dock_id are required" });

    try {
      const { data: appt } = await db.from("appointments").select("*").eq("id", req.params.id).eq("facility_id", facilityId).maybeSingle();
      if (!appt) return res.status(404).json({ error: "Booking request not found" });
      if (appt.status !== "REQUESTED") return res.status(400).json({ error: `Already ${appt.status}` });

      const endTime = estimateEndTime(start_time, appt.load_type, appt.load_weight_kg);
      const date = String(start_time).slice(0, 10);
      const [{ data: dockRule }, { data: dayAppointments }] = await Promise.all([
        db.from("dock_rules").select("allowed_equipment_types").eq("facility_id", facilityId).eq("dock_door_id", dock_id).maybeSingle(),
        db.from("appointments").select("dock_id, start_time, end_time, load_type, status").eq("facility_id", facilityId).neq("status", "CANCELLED").neq("id", appt.id)
          .gte("start_time", `${date}T00:00:00`).lte("start_time", `${date}T23:59:59`),
      ]);
      const conflict = findDockConflict({ dock_id, start_time, end_time: endTime, load_type: appt.load_type }, (dayAppointments || []) as any, dockRule?.allowed_equipment_types || null);
      if (conflict) return res.status(409).json({ error: conflict.reason });

      const { error } = await db.from("appointments").update({ start_time, end_time: endTime, dock_id, status: "SCHEDULED" }).eq("id", appt.id);
      if (error) throw error;

      logAudit({ action: "BOOKING_REQUEST_ASSIGNED", entityType: "APPOINTMENT", entityId: String(appt.id), details: { start_time, dock_id }, ip: req.ip, facility_id: facilityId });

      if (appt.carrier_id) {
        const { data: carrier } = await db.from("carriers").select("email, contact_phone").eq("id", appt.carrier_id).maybeSingle();
        const { data: dock } = await db.from("spots").select("name").eq("id", dock_id).maybeSingle();
        notify({
          type: "BOOKING_CONFIRMED", recipientType: "CARRIER", recipientId: appt.carrier_id, forceEmail: true,
          data: {
            phone: carrier?.contact_phone, email: carrier?.email, title: "Booking confirmed",
            body: `SkyYard: ${appt.plate} is booked for ${new Date(start_time).toLocaleString()} at ${dock?.name || "a dock"}.`,
            link: "/carrier",
          },
        });
      }

      emitUpdate("appointment_updated", { id: appt.id });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 4: Live-verify**

Restart the dev server. Seed a request (same insert as Task 3 Step 4), find its `id` and a real dock spot id, then:

```javascript
fetch('/api/admin/booking-requests/<id>/assign', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ start_time: new Date(Date.now()+3600000).toISOString(), dock_id: <dockId> }) }).then(r => r.json())
```

Confirm `{success:true}`, then via SQL confirm `status='SCHEDULED'` and `start_time`/`dock_id` are set. Check `notifications_queue` has a new `email` row addressed to the test carrier (create one with a real `email` first if none exists — this now queues correctly even with no `notification_preferences` row, because of the `forceEmail: true` override added in Step 1) and an `in_app_notifications` row. Clean up test rows after.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat: assign a booking request to a slot, notify the carrier"
```

---

### Task 6: Reschedule an existing appointment (the swap)

**Files:**
- Modify: `server.ts`

**Interfaces:**
- Consumes: `notify()`'s `forceEmail?: boolean` param, added in Task 5 Step 1 — pass `forceEmail: true` so the email queues even though no `notification_preferences` row exists yet for `recipientType: "CARRIER"`.
- Produces route: `POST /api/appointments/:id/reschedule` (requireRole superadmin/ADMIN/GUARD) — body `{ start_time: string }`, returns `{ success: true }` or `409 { error }`.

- [ ] **Step 1: Add the route**

Insert directly after the route added in Task 5:

```typescript
  // Dragging an *already-scheduled* appointment to a new cell. Deliberately
  // separate from PATCH /api/appointments/:id (the general-purpose edit
  // endpoint the edit modal uses) so the "booking swapped" notification
  // fires only when a drag actually changes the time — never on an
  // unrelated field edit from the modal.
  app.post("/api/appointments/:id/reschedule", requireRole("superadmin", "ADMIN", "GUARD"), async (req: any, res) => {
    const { start_time } = req.body;
    const facilityId = req.facilityId;
    if (!start_time) return res.status(400).json({ error: "start_time is required" });

    try {
      const { data: appt } = await db.from("appointments").select("*").eq("id", req.params.id).eq("facility_id", facilityId).maybeSingle();
      if (!appt) return res.status(404).json({ error: "Appointment not found" });
      if (!appt.dock_id) return res.status(400).json({ error: "This appointment has no dock assigned yet" });

      const oldStartTime = appt.start_time;
      const endTime = estimateEndTime(start_time, appt.load_type, appt.load_weight_kg);
      const date = String(start_time).slice(0, 10);
      const [{ data: dockRule }, { data: dayAppointments }] = await Promise.all([
        db.from("dock_rules").select("allowed_equipment_types").eq("facility_id", facilityId).eq("dock_door_id", appt.dock_id).maybeSingle(),
        db.from("appointments").select("dock_id, start_time, end_time, load_type, status").eq("facility_id", facilityId).neq("status", "CANCELLED").neq("id", appt.id)
          .gte("start_time", `${date}T00:00:00`).lte("start_time", `${date}T23:59:59`),
      ]);
      const conflict = findDockConflict({ dock_id: appt.dock_id, start_time, end_time: endTime, load_type: appt.load_type }, (dayAppointments || []) as any, dockRule?.allowed_equipment_types || null);
      if (conflict) return res.status(409).json({ error: conflict.reason });

      const { error } = await db.from("appointments").update({ start_time, end_time: endTime }).eq("id", appt.id);
      if (error) throw error;

      logAudit({ action: "APPOINTMENT_RESCHEDULED", entityType: "APPOINTMENT", entityId: String(appt.id), details: { from: oldStartTime, to: start_time }, ip: req.ip, facility_id: facilityId });

      if (appt.carrier_id) {
        const { data: carrier } = await db.from("carriers").select("email, contact_phone").eq("id", appt.carrier_id).maybeSingle();
        notify({
          type: "BOOKING_SWAPPED", recipientType: "CARRIER", recipientId: appt.carrier_id, forceEmail: true,
          data: {
            phone: carrier?.contact_phone, email: carrier?.email, title: "Booking time changed",
            body: `SkyYard: ${appt.plate}'s booking moved from ${new Date(oldStartTime).toLocaleString()} to ${new Date(start_time).toLocaleString()}.`,
            link: "/carrier",
          },
        });
      }

      emitUpdate("appointment_updated", { id: appt.id });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
```

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 3: Live-verify**

Restart the dev server. Using the appointment scheduled in Task 5's verification (or a fresh one), call:

```javascript
fetch('/api/appointments/<id>/reschedule', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ start_time: new Date(Date.now()+7200000).toISOString() }) }).then(r => r.json())
```

Confirm `{success:true}`, confirm `start_time` changed via SQL, confirm a new `notifications_queue` row with type `BOOKING_SWAPPED` mentioning both old and new times. Clean up test rows.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: reschedule endpoint for dragging an existing appointment, notifies the carrier"
```

---

### Task 7: Carrier Portal — Request a booking form

**Files:**
- Modify: `src/pages/CarrierPortal.tsx`

**Interfaces:**
- Consumes: `POST /api/carrier/booking-requests` (Task 2)

- [ ] **Step 1: Add form state**

In `src/pages/CarrierPortal.tsx`, find the existing state declarations (`const [disputeBusy, setDisputeBusy] = useState(false);`) and add directly after:

```typescript
  const CARGO_TYPES = ["Pallets", "Boxes", "Shipping container", "Other"];
  const LOAD_TYPES = ["standard", "reefer", "flatbed", "tanker", "hazmat", "oversized"];
  const [requestForm, setRequestForm] = useState({ plate: "", personal_id_number: "", cargo_type: "", cargo_quantity: "", load_type: "standard" });
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestSuccess, setRequestSuccess] = useState(false);

  const submitBookingRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestError("");
    setRequestSuccess(false);
    setRequestBusy(true);
    const res = await fetch("/api/carrier/booking-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestForm),
    });
    setRequestBusy(false);
    if (res.ok) {
      setRequestSuccess(true);
      setRequestForm({ plate: "", personal_id_number: "", cargo_type: "", cargo_quantity: "", load_type: "standard" });
      loadDashboard();
    } else {
      const d = await res.json().catch(() => ({}));
      setRequestError(d.error || "Failed to submit request");
    }
  };
```

- [ ] **Step 2: Add the form to the JSX**

Find the section that renders `stats`/KPI cards in the main dashboard return (search for `{stats.` or the first `<div` after `{carrier && (` in the render). Insert this block directly before the existing appointments list section (search for where `appointments.map` begins and insert the new block just above that section's wrapping `<div>`):

```tsx
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm mb-6">
            <h3 className="font-bold text-slate-900 text-lg mb-1">Request a booking</h3>
            <p className="text-slate-500 text-sm mb-4">Tell us what's coming — an admin will place it on the schedule and you'll be notified.</p>
            {requestSuccess && (
              <div className="bg-teal-50 border border-teal-200 text-teal-700 rounded-xl px-4 py-2.5 text-sm font-bold mb-4">
                Request submitted — you'll be notified once it's scheduled.
              </div>
            )}
            {requestError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-sm font-bold mb-4">{requestError}</div>
            )}
            <form onSubmit={submitBookingRequest} className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Vehicle plate</label>
                <input required value={requestForm.plate} onChange={(e) => setRequestForm({ ...requestForm, plate: e.target.value.toUpperCase() })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Driver personal ID number</label>
                <input required value={requestForm.personal_id_number} onChange={(e) => setRequestForm({ ...requestForm, personal_id_number: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Load type</label>
                <select value={requestForm.load_type} onChange={(e) => setRequestForm({ ...requestForm, load_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
                  {LOAD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Cargo type</label>
                <select required value={requestForm.cargo_type} onChange={(e) => setRequestForm({ ...requestForm, cargo_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Select...</option>
                  {CARGO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {requestForm.cargo_type && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Quantity</label>
                  <input value={requestForm.cargo_quantity} onChange={(e) => setRequestForm({ ...requestForm, cargo_quantity: e.target.value })} placeholder="e.g. 24" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm" />
                </div>
              )}
              <div className="col-span-2">
                <button type="submit" disabled={requestBusy} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2">
                  {requestBusy && <Loader2 size={14} className="animate-spin" />} Submit request
                </button>
              </div>
            </form>
          </div>
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 4: Live-verify**

Restart the dev server (frontend hot-reloads, but confirm no console errors). Log into `/carrier` with a real carrier account (or create one via SQL if none exists — `carriers` table needs a real `password_hash`; use an existing seeded carrier if one exists, checked via `select email from carriers limit 1`). Submit the form, confirm the success message, and confirm via SQL a new `appointments` row with `status='REQUESTED'` and the submitted fields. Clean up.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CarrierPortal.tsx
git commit -m "feat: Carrier Portal booking request form"
```

---

### Task 8: Install @dnd-kit, build the requests sidebar

**Files:**
- Modify: `package.json`
- Create: `src/components/BookingRequestsSidebar.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/booking-requests` (Task 3)
- Produces: `<BookingRequestsSidebar />` — a `useDraggable`-wrapped card list. Exports `BookingRequestCard` type: `{ id: number; plate: string; carrier: string; personal_id_number: string; cargo_type: string; cargo_quantity: string | null; load_type: string; created_at: string }`.

- [ ] **Step 1: Install the dependency**

Run: `npm install @dnd-kit/core`

- [ ] **Step 2: Write the component**

```tsx
// src/components/BookingRequestsSidebar.tsx
import React, { useEffect, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Package, Clock } from "lucide-react";

export interface BookingRequestCard {
  id: number;
  plate: string;
  carrier: string;
  personal_id_number: string;
  cargo_type: string;
  cargo_quantity: string | null;
  load_type: string;
  created_at: string;
}

function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function DraggableRequestCard({ request }: { request: BookingRequestCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `request-${request.id}`,
    data: { type: "request", request },
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`bg-white border border-slate-200 rounded-2xl p-4 cursor-grab active:cursor-grabbing shadow-sm hover:border-indigo-300 transition-all touch-none ${isDragging ? "opacity-50 z-50" : ""}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <p className="font-black text-slate-900 text-sm">{request.plate}</p>
        <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1"><Clock size={9} /> {timeAgo(request.created_at)}</span>
      </div>
      <p className="text-xs font-bold text-slate-500 truncate">{request.carrier}</p>
      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-600">
        <Package size={11} className="text-indigo-400 shrink-0" />
        <span className="truncate">{request.cargo_type}{request.cargo_quantity ? ` · ${request.cargo_quantity}` : ""}</span>
      </div>
      <p className="text-[10px] text-slate-400 mt-1">ID: {request.personal_id_number}</p>
    </div>
  );
}

export default function BookingRequestsSidebar({ refreshKey }: { refreshKey?: number }) {
  const [requests, setRequests] = useState<BookingRequestCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/booking-requests")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRequests)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  return (
    <div className="w-72 shrink-0 bg-slate-50/50 border border-slate-200 rounded-3xl p-4 h-[70vh] overflow-y-auto custom-scrollbar">
      <h3 className="font-bold text-slate-900 text-sm mb-1">Booking requests</h3>
      <p className="text-[11px] text-slate-500 mb-4">Drag a card onto a time slot to schedule it.</p>
      {loading && <p className="text-xs text-slate-400 text-center py-8">Loading...</p>}
      {!loading && requests.length === 0 && <p className="text-xs text-slate-400 text-center py-8">No pending requests.</p>}
      <div className="space-y-3">
        {requests.map((r) => <DraggableRequestCard key={r.id} request={r} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/BookingRequestsSidebar.tsx
git commit -m "feat: booking requests sidebar with draggable cards"
```

---

### Task 9: Assign popover

**Files:**
- Create: `src/components/BookingAssignPopover.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/booking-slot-availability`, `POST /api/admin/booking-requests/:id/assign`, `POST /api/appointments/:id/reschedule`
- Produces: `<BookingAssignPopover mode="assign" | "reschedule" requestOrAppt={...} dropTime={ISOstring} position={{x,y}} onConfirm={() => void} onCancel={() => void} />`

- [ ] **Step 1: Write the component**

```tsx
// src/components/BookingAssignPopover.tsx
import React, { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

interface DockOption { dockId: number; dockName: string; score: number; available: boolean; conflictReason: string | null }

export default function BookingAssignPopover({
  mode, plate, loadType, requestId, appointmentId, dropTime, position, onConfirm, onCancel,
}: {
  mode: "assign" | "reschedule";
  plate: string;
  loadType: string;
  requestId?: number;
  appointmentId?: number;
  dropTime: string;
  position: { x: number; y: number };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [docks, setDocks] = useState<DockOption[]>([]);
  const [loadingDocks, setLoadingDocks] = useState(mode === "assign");
  const [selectedDockId, setSelectedDockId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode !== "assign") return;
    fetch(`/api/admin/booking-slot-availability?start_time=${encodeURIComponent(dropTime)}&load_type=${loadType}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: DockOption[]) => {
        setDocks(d);
        const best = d.find((x) => x.available);
        if (best) setSelectedDockId(best.dockId);
      })
      .finally(() => setLoadingDocks(false));
  }, [mode, dropTime, loadType]);

  const confirm = async () => {
    setError("");
    setBusy(true);
    const url = mode === "assign" ? `/api/admin/booking-requests/${requestId}/assign` : `/api/appointments/${appointmentId}/reschedule`;
    const body = mode === "assign" ? { start_time: dropTime, dock_id: selectedDockId } : { start_time: dropTime };
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        onConfirm();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Failed");
      }
    } catch {
      setError("Network error — check your connection and try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed z-[9999] bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 w-80"
      style={{ left: Math.min(position.x, window.innerWidth - 340), top: Math.min(position.y, window.innerHeight - 280) }}
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-bold text-slate-900 text-sm">{mode === "assign" ? "Schedule this booking?" : "Move this booking?"}</h4>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-900"><X size={16} /></button>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        <span className="font-bold text-slate-900">{plate}</span> {mode === "assign" ? "to" : "moves to"} <span className="font-bold text-slate-900">{new Date(dropTime).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
      </p>

      {mode === "assign" && (
        <div className="mb-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">Dock</label>
          {loadingDocks ? (
            <p className="text-xs text-slate-400">Checking availability...</p>
          ) : (
            <select value={selectedDockId ?? ""} onChange={(e) => setSelectedDockId(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
              <option value="" disabled>Select a dock...</option>
              {docks.map((d) => (
                <option key={d.dockId} value={d.dockId} disabled={!d.available}>
                  {d.dockName}{d.available ? ` (score ${d.score})` : ` — ${d.conflictReason}`}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600 font-bold mb-3">{error}</p>}

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 bg-slate-100 text-slate-600 text-xs font-bold py-2 rounded-xl hover:bg-slate-200 transition-all">Cancel</button>
        <button
          onClick={confirm}
          disabled={busy || (mode === "assign" && !selectedDockId)}
          className="flex-1 bg-indigo-600 text-white text-xs font-bold py-2 rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {busy && <Loader2 size={12} className="animate-spin" />} Confirm
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/BookingAssignPopover.tsx
git commit -m "feat: assign/reschedule confirm popover with dock picker"
```

---

### Task 10: Wire drag-and-drop into the Calendar

**Files:**
- Modify: `src/components/AppointmentCalendar.tsx`

**Interfaces:**
- Consumes: `<BookingRequestsSidebar>` (Task 8), `<BookingAssignPopover>` (Task 9)

- [ ] **Step 1: Add imports and drag/drop state**

At the top of `src/components/AppointmentCalendar.tsx`, add:

```typescript
import { DndContext, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import BookingRequestsSidebar from "./BookingRequestsSidebar";
import BookingAssignPopover from "./BookingAssignPopover";
```

In the main `AppointmentCalendar` component function, find the existing `const [isModalOpen, setIsModalOpen] = useState(false);` (or similar top-level state block) and add directly after:

```typescript
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [pendingDrop, setPendingDrop] = useState<{
    mode: "assign" | "reschedule"; plate: string; loadType: string;
    requestId?: number; appointmentId?: number; dropTime: string; position: { x: number; y: number };
  } | null>(null);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, activatorEvent } = event;
    if (!over) return;
    const dropData = over.data.current as { day: Date; hour: number } | undefined;
    if (!dropData) return;
    const dropTime = new Date(dropData.day);
    dropTime.setHours(dropData.hour, 0, 0, 0);

    const dragData = active.data.current as { type: "request"; request: any } | { type: "appointment"; appointment: any };
    const clientEvent = activatorEvent as MouseEvent;
    const position = { x: clientEvent?.clientX ?? 400, y: clientEvent?.clientY ?? 300 };

    if (dragData.type === "request") {
      setPendingDrop({ mode: "assign", plate: dragData.request.plate, loadType: dragData.request.load_type, requestId: dragData.request.id, dropTime: dropTime.toISOString(), position });
    } else {
      setPendingDrop({ mode: "reschedule", plate: dragData.appointment.plate, loadType: dragData.appointment.load_type, appointmentId: dragData.appointment.id, dropTime: dropTime.toISOString(), position });
    }
  };
```

- [ ] **Step 2: Make hour cells droppable in WeekView**

In `WeekView`, find:

```tsx
              {hours.map((hour: number) => (
                <div key={hour} className="h-20 border-b border-slate-50 relative group">
                  <div className="absolute inset-0 bg-indigo-50/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center">
                    <Plus size={16} className="text-indigo-400" />
                  </div>
                </div>
              ))}
```

Replace with:

```tsx
              {hours.map((hour: number) => <DroppableHourCell key={hour} day={day} hour={hour} />)}
```

Add this new component in the same file, directly above `function WeekView`:

```tsx
function DroppableHourCell({ day, hour }: { day: Date; hour: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${day.toISOString()}_${hour}`, data: { day, hour } });
  return (
    <div ref={setNodeRef} className={`h-20 border-b border-slate-50 relative group transition-colors ${isOver ? "bg-indigo-100" : ""}`}>
      <div className="absolute inset-0 bg-indigo-50/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center pointer-events-none">
        <Plus size={16} className="text-indigo-400" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Make existing appointment blocks draggable in WeekView**

Find the `motion.div` that renders each appointment (`key={appt.id}` with `onClick={() => onEdit(appt)}`) inside `WeekView`. Wrap the rendering with a small draggable wrapper. Replace:

```tsx
                  return (
                    <motion.div 
                      key={appt.id}
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      onClick={() => onEdit(appt)}
```

with:

```tsx
                  return (
                    <DraggableAppointmentBlock key={appt.id} appt={appt}>
                    <motion.div 
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      onClick={() => onEdit(appt)}
```

and find that same block's closing:

```tsx
                    </motion.div>
                  );
                })
              }
```

replace with:

```tsx
                    </motion.div>
                    </DraggableAppointmentBlock>
                  );
                })
              }
```

Add this new component directly above `DroppableHourCell`:

```tsx
function DraggableAppointmentBlock({ appt, children, className = "", style }: { appt: any; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `appt-${appt.id}`, data: { type: "appointment", appointment: appt } });
  const dragStyle: React.CSSProperties = { ...style, ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}) };
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`touch-none ${className} ${isDragging ? "opacity-50 z-50" : ""}`} style={dragStyle}>
      {children}
    </div>
  );
}
```

**Why `transform`/`isDragging`/`className`/`style` are required, not optional polish:** WeekView's appointment `motion.div` is absolutely positioned (`className="absolute left-1 right-1 z-10 ..."`, `style={{ top, height, minHeight: 40 }}`) relative to its hour-column parent. If `DraggableAppointmentBlock` renders a plain unstyled `<div className="touch-none">` around it (as an earlier version of this snippet did), that wrapper div is a zero-size box — its only child is taken out of flow by `absolute`, so the wrapper itself collapses to `height: 0`. dnd-kit measures the draggable node's own rect for collision detection, and a zero-height rect never intersects any droppable cell, so `over` is always `null` in `handleDragEnd` and a WeekView reschedule drag silently does nothing (fails the plan's own Day+Week reschedule requirement). The fix is to move the positioning from the inner `motion.div` onto this wrapper (`WeekView`'s call site passes `className="absolute left-1 right-1 z-10"` and `style={{ top, height, minHeight: 40 }}` into `DraggableAppointmentBlock`, and the inner `motion.div` becomes `relative w-full h-full` instead) so the wrapper has the real, correctly-sized rect. `transform`/`isDragging` additionally give the same drag-lift visual feedback `DraggableRequestCard` already has in the sidebar — without it, a block that IS being dragged shows no visual difference from one that isn't, which is also how this bug hid during manual testing.

Add `useDraggable` to the existing `@dnd-kit/core` import at the top of the file:

```typescript
import { DndContext, useDroppable, useDraggable, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
```

**Why `PointerSensor`/`KeyboardSensor`/`useSensor`/`useSensors` are required:** `DndContext` with no `sensors` prop falls back to dnd-kit's `defaultSensors`, which use `PointerSensor` with no `activationConstraint`. Without a constraint, the sensor treats every `pointerdown` on a draggable as a potential drag start and installs a capture-phase `click` blocker on `document` for ~50ms — including on a plain click with zero movement. Since every appointment block in both WeekView and DayView is now wrapped in `DraggableAppointmentBlock`, this silently breaks WeekView's existing `onClick={() => onEdit(appt)}` and DayView's `ActionMenu` "Edit"/"Delete" trigger (both live inside the wrapper) — a real regression against pre-existing behavior, not something the brief's e2e drag verification would catch, since it never clicks an appointment. The fix is a `distance` activation constraint, added and used in Step 5 below.

- [ ] **Step 4: Repeat Steps 2-3's cell/block changes for DayView — but check the assumption first**

**Do not assume DayView shares WeekView's layout.** Read `DayView`'s actual JSX before touching it. If it uses the same absolute-positioned `h-20` hour-cell grid as WeekView, apply the identical `DroppableHourCell` substitution and wrap appointment blocks in `DraggableAppointmentBlock` the same way (passing whatever positioning className/style WeekView's call site uses, per the note in Step 3). If DayView instead renders each hour as a flex row (a time label + a list of card-style appointments, not an absolute-positioned grid) — wrap the *entire* row in a droppable, not a per-cell grid: a `DroppableDayRow({ day, hour, children })` component using `useDroppable({ id: \`${day.toISOString()}_${hour}\`, data: { day, hour } })` (same id format and `data` shape as `DroppableHourCell`, so `handleDragEnd` needs no DayView-specific branch), preserving the row's exact original `className` so borders/spacing/hover states are unaffected. Wrap each appointment card in `DraggableAppointmentBlock` (no special positioning needed here — an in-flow card already has a real rect) without adding an `onClick` if the original card didn't have one (DayView may route editing through an `ActionMenu` button instead — preserve whatever the original edit/delete entry point was, and make sure it's still clickable per the sensor note in Step 3).

- [ ] **Step 5: Wrap the calendar in DndContext (with a sensor activation constraint) and mount the sidebar**

Find the main `return (` of the `AppointmentCalendar` component (the outermost JSX). Just before the `return (`, add:

```tsx
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
```

This requires 8px of pointer movement before a drag starts, so a plain click never triggers dnd-kit's click-blocking behavior (see the note under Step 3) — a click resolves as a click, a drag past 8px resolves as a drag. `KeyboardSensor` is re-added explicitly because passing any `sensors` array to `DndContext` replaces dnd-kit's defaults entirely, not merges with them.

Wrap the whole returned tree in `<DndContext sensors={sensors} onDragEnd={handleDragEnd}>`, and change the layout to a flex row with the sidebar alongside the existing calendar block. Find:

```tsx
    <div className="min-h-full flex flex-col gap-6 max-w-[1600px] mx-auto px-4 lg:px-8 pb-8">
```

Replace with:

```tsx
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
    <div className="min-h-full flex flex-col gap-6 max-w-[1600px] mx-auto px-4 lg:px-8 pb-8">
```

Find the existing calendar-grid wrapper:

```tsx
      <div className="h-[70vh] shrink-0 bg-white border border-slate-200 rounded-[2.5rem] shadow-xl shadow-slate-200/50 overflow-hidden flex flex-col">
```

Replace with (wrapping it and the new sidebar in a flex row, sidebar only shown for Day/Week views):

```tsx
      <div className="flex gap-6 items-start">
      {(view === "day" || view === "week") && <BookingRequestsSidebar refreshKey={sidebarRefreshKey} />}
      <div className="h-[70vh] shrink-0 flex-1 bg-white border border-slate-200 rounded-[2.5rem] shadow-xl shadow-slate-200/50 overflow-hidden flex flex-col">
```

Find that same block's matching closing `</div>` (the one that currently closes the calendar-grid wrapper, immediately before `{/* Add Appointment Modal */}` or `<VehicleLog />`) and add one more closing `</div>` to close the new flex row wrapper.

Find the component's final closing tags (end of the returned JSX) and add the popover render plus the `DndContext` closing tag. Directly before the final `</div>\n  );\n}` of the component, add:

```tsx
      {pendingDrop && (
        <BookingAssignPopover
          mode={pendingDrop.mode}
          plate={pendingDrop.plate}
          loadType={pendingDrop.loadType}
          requestId={pendingDrop.requestId}
          appointmentId={pendingDrop.appointmentId}
          dropTime={pendingDrop.dropTime}
          position={pendingDrop.position}
          onCancel={() => setPendingDrop(null)}
          onConfirm={() => {
            setPendingDrop(null);
            setSidebarRefreshKey((k) => k + 1);
            fetchAppointments();
          }}
        />
      )}
    </div>
    </DndContext>
```

(`fetchAppointments` is the existing function this component already calls elsewhere to reload the calendar's own data — reuse it, don't add a second one.)

- [ ] **Step 6: Typecheck**

Run: `npm run lint`
Expected: no errors — if `fetchAppointments` isn't in scope at that point in the file, use whichever existing reload function this component already calls after create/edit/delete (check the existing `onSuccess` callback passed to `CreateAppointmentModal` for the exact name).

- [ ] **Step 7: Full verification and live test**

Run: `npx vitest run && npm run build`
Expected: all pass, clean build.

Restart the dev server. Log in as admin, open `/calendar`, switch to Week view. Seed one booking request via SQL (same insert as Task 3). Confirm the sidebar shows the card. Drag it onto an hour cell — confirm the popover opens showing the dropped time and a ranked dock list, confirm, and verify the card disappears from the sidebar and the appointment now renders on the grid at that time. Then drag that same appointment block to a different cell — confirm the reschedule popover, confirm, and verify it moved. Check `notifications_queue` for both a `BOOKING_CONFIRMED` and a `BOOKING_SWAPPED` row. Clean up all test data.

- [ ] **Step 8: Commit**

```bash
git add src/components/AppointmentCalendar.tsx
git commit -m "feat: wire drag-and-drop scheduling into the Calendar's Day/Week views"
```

---

### Task 11: Hide the old public booking link

**Files:**
- Modify: `src/pages/Login.tsx`

**Interfaces:**
- None (UI-only change)

- [ ] **Step 1: Remove the link**

In `src/pages/Login.tsx`, find the `<Link to="/book/demo">` (or equivalent "Carrier booking" link/button near the top-right of the login page) and delete it — same treatment as the earlier `HIDDEN_ROUTES` work: the route and `BookingPage.tsx` component stay in the codebase, just no longer linked to.

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 3: Live-verify**

Restart. Load the login page, confirm "Carrier booking" no longer appears in the header.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Login.tsx
git commit -m "feat: hide the old public self-service booking link"
```

---

### Task 12: Full regression pass and push

**Files:** none

- [ ] **Step 1: Full suite**

Run: `npm run lint && npx vitest run && npm run build`
Expected: all clean.

- [ ] **Step 2: End-to-end live walkthrough**

Submit a real booking request from `/carrier`, assign it from `/calendar` via drag-and-drop, reschedule it via drag-and-drop, confirm both notifications queued correctly, confirm the Dashboard's Bookings KPI and its detail table (built earlier this session) still render this appointment correctly once scheduled. Clean up all test data created during this task.

- [ ] **Step 3: Push**

```bash
git push origin feature/stitch-yms-redesign
```

---

## Self-Review Notes

- **Spec coverage:** Carrier request form (Task 7) ✓, sidebar (Task 8) ✓, drag-to-schedule with dock auto-pick + override (Tasks 4, 5, 9, 10) ✓, reschedule/swap with notification (Tasks 6, 9, 10) ✓, email via existing queue targeting `carrier.email` (Tasks 5, 6) ✓, old picker hidden not deleted (Task 11) ✓, Day/Week-only scope (Task 10, Step 5's view check) ✓.
- **Placeholder scan:** no TBD/TODO; every step has complete code.
- **Type consistency:** `BookingRequestCard` (Task 8) matches the `GET /api/admin/booking-requests` response shape (Task 3). `BookingAssignPopover`'s `mode`/`requestId`/`appointmentId` props (Task 9) match exactly how Task 10 constructs `pendingDrop`. Route bodies (`{start_time, dock_id}` / `{start_time}`) match what the popover sends.
