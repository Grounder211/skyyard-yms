# Command Center — "Today's Operations" Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real "expected arrivals today / no-shows today / active moves" counts to the existing staff Dashboard (`/`), closing the one genuine gap between it and the mega-prompt's "Command Center" spec — everything else in that spec (occupancy, action center with severity buckets + direct action links, detention/safety/document/reefer/stale-pass alerts) already exists and is real (`/api/admin/needs-attention`, Phase NN/BB).

**Architecture:** Extend the existing `getYardStatus()` helper in `server.ts` (already the single source `Dashboard` reads from) with one more query block returning a `today` object. No new endpoint, no new table — this is additive to a function every other caller of `/api/yard-status` already tolerates extra fields from. Frontend renders three more `StatItem`s in the existing stat grid.

**Tech Stack:** Express + Supabase JS client (existing), React 19 (existing `App.tsx` inline `Dashboard()` component), Vitest for the pure-function test.

## Global Constraints

- Never fake a number. If a count can't be computed from real data, don't show it.
- Reuse `getYardStatus()` — do not create a second endpoint that duplicates its facility-scoping or its existing `todayStart` calculation (server.ts:170-171).
- Follow the existing phase discipline: implement → typecheck → test → live-verify against the real dev server/DB → clean up any test data → commit.
- `requireRole` on `/api/yard-status` already covers `superadmin, ADMIN, GUARD, HOSTLER` (Phase AAA) — no auth change needed here.

---

### Task 1: Pure function for "is this appointment a no-show today" / active-moves count query

**Files:**
- Create: `server/services/todayOps.ts`
- Test: `server/services/todayOps.test.ts`

**Interfaces:**
- Produces: `countTodayNoShows(appointments: {no_show_flag: boolean; start_time: string}[], todayStartIso: string): number` — pure, used by the endpoint to avoid re-deriving the "today" boundary logic inline (matches the existing `todayStart` pattern at server.ts:170).
- Produces: `countExpectedArrivalsToday(appointments: {status: string; start_time: string}[], todayStartIso: string, todayEndIso: string): number` — counts appointments with `status === "SCHEDULED"` whose `start_time` falls within `[todayStartIso, todayEndIso)`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/services/todayOps.test.ts
import { describe, it, expect } from "vitest";
import { countTodayNoShows, countExpectedArrivalsToday } from "./todayOps.js";

describe("countTodayNoShows", () => {
  const todayStart = "2026-08-09T00:00:00.000Z";

  it("counts only no-shows with start_time today", () => {
    const appts = [
      { no_show_flag: true, start_time: "2026-08-09T08:00:00Z" },
      { no_show_flag: true, start_time: "2026-08-08T08:00:00Z" }, // yesterday
      { no_show_flag: false, start_time: "2026-08-09T09:00:00Z" },
    ];
    expect(countTodayNoShows(appts, todayStart)).toBe(1);
  });

  it("returns 0 when there are none", () => {
    expect(countTodayNoShows([], todayStart)).toBe(0);
  });
});

describe("countExpectedArrivalsToday", () => {
  const todayStart = "2026-08-09T00:00:00.000Z";
  const todayEnd = "2026-08-10T00:00:00.000Z";

  it("counts only SCHEDULED appointments starting today", () => {
    const appts = [
      { status: "SCHEDULED", start_time: "2026-08-09T14:00:00Z" },
      { status: "SCHEDULED", start_time: "2026-08-10T01:00:00Z" }, // tomorrow
      { status: "no_show", start_time: "2026-08-09T10:00:00Z" }, // already resolved, not "expected"
      { status: "SCHEDULED", start_time: "2026-08-08T23:00:00Z" }, // yesterday
    ];
    expect(countExpectedArrivalsToday(appts, todayStart, todayEnd)).toBe(1);
  });

  it("returns 0 for an empty list", () => {
    expect(countExpectedArrivalsToday([], todayStart, todayEnd)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/todayOps.test.ts`
Expected: FAIL — `Cannot find module './todayOps.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/services/todayOps.ts
export function countTodayNoShows(
  appointments: { no_show_flag: boolean; start_time: string }[],
  todayStartIso: string
): number {
  const todayStart = new Date(todayStartIso).getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  return appointments.filter((a) => {
    if (!a.no_show_flag) return false;
    const t = new Date(a.start_time).getTime();
    return t >= todayStart && t < todayEnd;
  }).length;
}

export function countExpectedArrivalsToday(
  appointments: { status: string; start_time: string }[],
  todayStartIso: string,
  todayEndIso: string
): number {
  const start = new Date(todayStartIso).getTime();
  const end = new Date(todayEndIso).getTime();
  return appointments.filter((a) => {
    if (a.status !== "SCHEDULED") return false;
    const t = new Date(a.start_time).getTime();
    return t >= start && t < end;
  }).length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/todayOps.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/todayOps.ts server/services/todayOps.test.ts
git commit -m "test: add pure functions for today's-arrivals/no-show counts"
```

---

### Task 2: Wire `today` object into `getYardStatus()` and `/api/yard-status`

**Files:**
- Modify: `server.ts:1-30` (imports section — add the new import)
- Modify: `server.ts:115-175` (inside `getYardStatus`, right after the existing `avgDwellMinutes` block at line ~174, and the function's final `return` statement)

**Interfaces:**
- Consumes: `countTodayNoShows`, `countExpectedArrivalsToday` from Task 1 (`server/services/todayOps.js`).
- Consumes: the existing `todayStart` variable already computed in `getYardStatus` at server.ts:170-171 — do not recompute it.
- Produces: the `getYardStatus()` return object gains a `today: { expectedArrivals: number; noShows: number; activeMoves: number }` field. `activeMoves` is `moves.length` (the function already builds a `moves` array a few lines above — no new query needed for that one).

- [ ] **Step 1: Add the import**

At the top of `server.ts`, alongside the other `server/services/*` imports (e.g. near the `dockSla`/`gatePassStages` imports), add:

```typescript
import { countTodayNoShows, countExpectedArrivalsToday } from "./server/services/todayOps.js";
```

- [ ] **Step 2: Query today's appointments once, derive both counts**

Immediately after the existing block that computes `avgDwellMinutes` (server.ts:170-174), insert:

```typescript
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const { data: todaysAppointments } = await db
      .from("appointments")
      .select("status, start_time, no_show_flag")
      .eq("facility_id", facilityId)
      .gte("start_time", todayStart.toISOString())
      .lt("start_time", todayEnd);
    const today = {
      expectedArrivals: countExpectedArrivalsToday(todaysAppointments || [], todayStart.toISOString(), todayEnd),
      noShows: countTodayNoShows(todaysAppointments || [], todayStart.toISOString()),
      activeMoves: moves.length,
    };
```

- [ ] **Step 3: Add `today` to the function's return value**

Find the existing `return { stats: statsData, spots: flatSpots, moves, detentionThresholdHours: ..., avgDwellMinutes, dailyVelocity };` statement at the end of `getYardStatus` and change it to:

```typescript
    return { stats: statsData, spots: flatSpots, moves, detentionThresholdHours: fSettings?.detention_threshold_hours || 24, avgDwellMinutes, dailyVelocity, today };
```

(Keep every existing field — this only appends `today`.)

- [ ] **Step 4: Typecheck**

Run: `npm run lint`
Expected: no new TypeScript errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all existing tests plus the 4 new ones from Task 1 pass (89 total).

- [ ] **Step 6: Live-verify against the real dev server**

```bash
PORT=4001 nohup npm run dev > /tmp/dev4001.log 2>&1 &
sleep 4
curl -s -c /tmp/ck.txt -X POST http://localhost:4001/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@skyyard.se","password":"Skyyard#2026"}' > /dev/null
curl -s -b /tmp/ck.txt http://localhost:4001/api/yard-status | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['today'])"
```

Expected: prints a real object like `{'expectedArrivals': N, 'noShows': N, 'activeMoves': N}` with actual numbers from the DB, not placeholders. Cross-check `activeMoves` against `len(d['moves'])` in the same response — they must match exactly (same array, just counted).

Stop the server after verifying: `pkill -f "tsx server.ts"`

- [ ] **Step 7: Commit**

```bash
git add server.ts
git commit -m "feat: add today's expected-arrivals/no-shows/active-moves to yard-status"
```

---

### Task 3: Render the "Today's Operations" strip on the Dashboard

**Files:**
- Modify: `src/App.tsx` — inside `function Dashboard()` (currently starts at line 319)

**Interfaces:**
- Consumes: `data.today` from the `/api/yard-status` response fetched in `Dashboard`'s existing `useEffect` (App.tsx:326-334) — `{ expectedArrivals, noShows, activeMoves }`.
- Consumes: the existing `StatItem` component (already used four times in this same file for In-Yard/Available Docks/Avg. Dwell/Daily Velocity) — same props shape: `icon`, `label`, `value`, `sub`, `color`.

- [ ] **Step 1: Add `today` state**

In `Dashboard()`, alongside the existing `avgDwellMinutes`/`dailyVelocity` state declarations (App.tsx:323-324), add:

```typescript
  const [today, setToday] = React.useState<{ expectedArrivals: number; noShows: number; activeMoves: number }>({ expectedArrivals: 0, noShows: 0, activeMoves: 0 });
```

- [ ] **Step 2: Capture it from the existing fetch**

In the existing `.then(data => { ... })` block (App.tsx:329-334) that already sets `stats`/`spots`/`avgDwellMinutes`/`dailyVelocity`, add one more line:

```typescript
        setToday(data.today || { expectedArrivals: 0, noShows: 0, activeMoves: 0 });
```

- [ ] **Step 3: Add a second stat row**

Immediately after the existing four-`StatItem` grid (the `<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">...</div>` block ending around App.tsx:371), insert:

```tsx
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Reveal preset="fade-up" delay={275}>
          <StatItem icon={<Calendar />} label="Expected Arrivals Today" value={today.expectedArrivals} sub="Scheduled, not yet checked in" color="indigo" />
        </Reveal>
        <Reveal preset="fade-up" delay={300}>
          <StatItem icon={<AlertTriangle />} label="No-Shows Today" value={today.noShows} sub="Missed their grace period" color="amber" />
        </Reveal>
        <Reveal preset="fade-up" delay={325}>
          <StatItem icon={<ArrowRightLeft />} label="Active Moves" value={today.activeMoves} sub="In the dispatch queue" color="indigo" />
        </Reveal>
      </div>
```

- [ ] **Step 4: Add missing icon imports if not already present**

Check the top of `src/App.tsx` for `Calendar`, `AlertTriangle`, `ArrowRightLeft` in the existing `lucide-react` import line. Add any that are missing to that same import statement (do not add a second import line).

- [ ] **Step 5: Typecheck and build**

Run: `npm run lint && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 6: Live-verify in the browser**

Start the dev server, log in as `admin@skyyard.se` / `Skyyard#2026`, load `/`, and confirm the new "Today's Operations" row renders with real (not placeholder) numbers matching what `curl /api/yard-status` returned in Task 2's Step 6. If the browser pane is unreliable in this environment (a known recurring issue this session), confirm via `curl` + reading the rendered page text instead of a screenshot, and say so explicitly rather than claiming a pixel-level check that didn't happen.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: render Today's Operations strip on the staff Dashboard"
```
