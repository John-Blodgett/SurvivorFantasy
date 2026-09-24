# Known Bugs — Integration Test Suite

This document tracks bugs discovered by the integration test suite. Each entry corresponds to a test that asserts the **correct** expected behavior (per requirements) but fails against the current implementation.

## Bug Tracking Protocol

### Conventions

- **`it.fails()`** — Used when a test can be written and the assertion fails against current behavior. The test suite remains green because Vitest expects the test to fail.
- **`it.todo()`** — Used when a test cannot yet be fully implemented (e.g., missing infrastructure, unclear behavior).
- **`// BUG:` comment** — Added above the test describing expected vs actual behavior.

### Test Naming

Bug tests use the prefix: `BUG: <summary> — Req <ID>`

Example:
```typescript
// BUG: Trade acceptance should reject eliminated castaways — Req 7.6
it.fails("BUG: Trade acceptance should fail for eliminated castaways — Req 7.6", async () => {
  // ... test that asserts correct behavior
});
```

### When a Bug is Fixed

1. The `it.fails()` test will start passing (Vitest will report it as an unexpected pass)
2. Convert the test to a standard `it()` call
3. Remove the `// BUG:` comment
4. Remove the corresponding entry from this file

---

## Active Bugs

### BUG-003: Live draft fires premature auto-pick on turn advance (clock-skew race condition)

| Field | Value |
|-------|-------|
| **Test file** | _not yet covered — needs integration/timing test_ |
| **Test name** | _TBD_ |
| **Expected** | When a pick advances the draft to the next player, that player gets the full `pick_timer_seconds` window before any auto-pick can fire. |
| **Actual** | The next player's turn can be auto-picked almost immediately (observed ~887ms after the prior pick). In the Sept 2026 live draft, Justin picked Aaliyah at `03:34:35.339` and John was auto-picked Maggie at `03:34:36.226`, giving John no chance to choose. |
| **Root cause** | `draft-room.tsx` computes `timeLeft` from the server `pick_started_at` timestamp via `computeTimeLeft`. On turn advance the new `pick_started_at` is broadcast to all clients; a client whose local clock is ahead of the server (or with broadcast latency) computes `timeLeft <= 0` on arrival, which immediately satisfies the `timeLeft === 0` auto-pick effect. Any client can fire the auto-pick, so the most clock-skewed participant triggers it for the whole room. The API's `pickIndex` guard only prevents *duplicate* picks, not *early* ones. John also had no draft preferences set, so the fallback picked the first available castaway (Maggie). |
| **Discovered** | 2026-09-24 |
| **Resolution** | Add a floor so a freshly-started pick cannot be considered expired on arrival (require the timer to visibly count down locally rather than trusting the initial computed value), and/or restrict auto-pick firing to the active picker's own client. Consider clamping clock skew in `computeTimeLeft`. |

---

## Resolved Bugs

### BUG-002: Waiver processing did not verify drop castaway ownership at processing time (RESOLVED)

| Field | Value |
|-------|-------|
| **Resolution** | Threaded a current-ownership map (built from `team_assignments` at processing time) into `processWaiverClaims`. The per-target eligibility filter now marks any claim "lost" when the claimant no longer owns `drop_castaway_id`. Wired the map through both `processLeagueWaivers` (production) and the integration test harness `processWaivers`. |
| **Resolved** | 2026-09-24 |
| **Tests** | `src/test/integration/edge-cases.test.ts`: "should invalidate waiver claim when drop castaway was traded away before processing", "winning a claim consumes the drop castaway so a second claim dropping the same castaway loses", "a claim whose drop castaway is no longer owned at processing time must lose" (all — Req 8.5) |
| **Affected requirements** | Req 8.5 |
| **Note** | One-per-player behavior needs no separate cap: in a `roster_size = 1` league every claim drops the player's only castaway, so the existing per-drop-castaway rule already yields one winning claim per week. |

### BUG-001: episode_events table missing player_id column (RESOLVED)

| Field | Value |
|-------|-------|
| **Resolution** | Applied migration `add_player_id_to_episode_events` adding `player_id uuid REFERENCES profiles(id)` column |
| **Resolved** | 2025-01-13 |
| **Affected requirements** | Req 6.3, 7.8, 10.2 |
