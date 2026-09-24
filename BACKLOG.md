# Feature & Bug Backlog

Prioritized list of planned work. Each item can be turned into a full spec via Kiro when ready to implement.

---

## Active Work

## 6. Admin draft controls (pause / undo / manual pick)

**Type:** Feature
**Priority:** P1 (mitigates the draft race condition, gives admins recovery tools)

**Description:** Give league admins live control over an in-progress draft so they can recover from bugs or real-world interruptions (like the Sept 2026 premature auto-pick that gave John no chance to pick — see KNOWN_BUGS BUG-003).

**Scope:**
- **Pause / resume draft:** Admin can pause the draft, which freezes the pick timer for everyone. While paused, no auto-picks fire. Resume restarts the current pick's timer cleanly (new `pick_started_at`).
- **Undo last pick:** Admin can roll back the most recent pick — deletes the `draft_picks` row and matching `team_assignments` row, decrements `drafts.current_pick_index`, and resets `pick_started_at` for the reopened turn. Broadcast the reverted state to all clients.
- **Manual pick for another player:** Admin can select a castaway on behalf of the player whose turn it is (or force-assign for a specific pick), useful when someone is disconnected or a bug skipped them.
- All actions should broadcast via the existing realtime channel so open draft rooms update immediately.
- Guard against undo/pause after the draft is `complete` (or allow undo of the final pick to reopen it — decide during spec).

**Files likely affected:**
- New migration: allow `drafts.status = 'paused'` (extend the status check constraint)
- `src/app/league/[id]/draft/actions.ts` (new actions: `pauseDraftAction`, `resumeDraftAction`, `undoLastPickAction`, `adminPickForPlayerAction`)
- `src/components/draft-room.tsx` (admin control UI + handle `paused` status in timer/auto-pick effects)
- `src/lib/draft.ts` (any pure helpers for undo/index math)
- Tests in `src/test/` for the index/undo logic and `src/test/integration/` for the DB operations

**Related:** Fixing BUG-003 (KNOWN_BUGS) should ideally land alongside or before this, since these controls are the manual recovery path for that class of issue.

---

## 7. Tests for all of the above

**Type:** Testing
**Priority:** Alongside each feature

Each feature/bugfix above should include:
- Unit tests in `src/test/` for any new pure logic
- Integration tests in `src/test/integration/` for database operations
- Tests should be written as part of each feature's spec, not as a separate effort

---

## Shipped

These items were completed and verified in the codebase (audited 2026-09-24).

### Trade not reflecting on leaderboard (was #1, P0 bug)
All three trade acceptance actions (`acceptTradeInLeagueAction`, `acceptTradeAction`, `approveTradeAction`) now call `revalidatePath` for the leaderboard and team pages. Fixed.

### Challenge edit/resubmit (was #2, P2)
Superseded and expanded by the **configurable-challenge-types** spec (`.kiro/specs/configurable-challenge-types/`), which shipped free-response, multiple-choice, and survivor-dropdown types plus auto-grading. Edit/resubmit is implemented via `validateEditResponse` (`src/lib/challenges.ts`) and `editChallengeResponseAction` (`src/app/league/[id]/challenges/actions.ts`). Only optional property-test tasks remain unchecked in that spec.

### Waiver page redesign (was #3, P2)
Implemented via `src/components/waiver-pool-grid.tsx` and `src/components/waiver-pending-claims.tsx`, wired into `src/app/league/[id]/waiver/page.tsx` (available-players grid + pending claims).

### Tribe management (was #4, P1)
`tribes` table + `castaways.tribe_id` FK shipped; `src/lib/tribes.ts`, admin tribes page, and tribe-based scoring (`addTribeEventAction` + `buildTribeEvents`) all in place.

### Batch episode scoring (was #5, P1)
`addBatchEventsAction` + `buildBatchEvents` create the N×M events from the episode admin page.

---

## Implementation Order (Recommended)

1. **Draft race condition (KNOWN_BUGS BUG-003)** — Prevents unfair auto-picks; foundational for the draft-controls work below
2. **Admin draft controls (#6)** — Manual recovery path for the above

_(Waiver ownership re-check, KNOWN_BUGS BUG-002, was fixed 2026-09-24.)_
