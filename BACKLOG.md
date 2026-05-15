# Feature & Bug Backlog

Prioritized list of planned work. Each item can be turned into a full spec via Kiro when ready to implement.

---

## 1. BUG: Trade not reflecting on leaderboard (SPEC CREATED)

**Type:** Bugfix
**Priority:** P0 (broken existing functionality)
**Spec:** `.kiro/specs/trade-leaderboard-bug/`
**Status:** Requirements done, ready for implementation

**Problem:** After a trade is accepted, the leaderboard still shows the old roster. The trade shows correctly in transactions.

**Root Cause:** The three trade acceptance server actions (`acceptTradeInLeagueAction`, `acceptTradeAction`, `approveTradeAction`) update `team_assignments` correctly but don't call `revalidatePath` for the leaderboard page. Next.js serves stale cached data.

**Fix:** Add `revalidatePath(`/league/${leagueId}/leaderboard`)` to all three trade acceptance actions. Also revalidate `/league/${leagueId}/team` for good measure.

**Files to change:**
- `src/app/league/[id]/trades/actions.ts` (acceptTradeInLeagueAction)
- `src/app/dashboard/trade-actions.ts` (acceptTradeAction)
- `src/app/league/[id]/admin/trades/actions.ts` (approveTradeAction)

---

## 2. Challenge edit/resubmit

**Type:** Feature
**Priority:** P2

**Description:** Players should be able to edit and resubmit their challenge responses before the deadline. Currently once submitted, responses are locked.

**Scope:**
- Add an "Edit Response" button on the challenge submission UI
- Allow updating `challenge_submissions.response` if `deadline > now()` and `is_correct IS NULL` (not yet graded)
- Server action: `editChallengeResponseAction`
- Validation: cannot edit after deadline, cannot edit after grading

**Files likely affected:**
- `src/app/league/[id]/challenges/actions.ts` (new action)
- `src/app/league/[id]/challenges/page.tsx` (UI for edit button)
- `src/lib/challenges.ts` (validation logic)

---

## 3. Waiver page redesign

**Type:** Feature
**Priority:** P2

**Description:** The waiver page should show all available players (the waiver pool) in a clean grid/list. Clicking a player opens a bid form. Current UX is unclear.

**Scope:**
- Display all waiver-eligible castaways (non-eliminated, unassigned) in a card grid
- Each card shows castaway name, tribe, photo
- Clicking a card opens a modal/drawer with: bid amount input, drop castaway selector, submit button
- Show player's remaining budget prominently
- Show pending claims with ability to cancel/reorder

**Files likely affected:**
- `src/app/league/[id]/waiver/page.tsx` (complete redesign)
- `src/app/league/[id]/waiver/actions.ts` (may need adjustments)
- New component: `src/components/waiver-pool-card.tsx`
- New component: `src/components/waiver-bid-modal.tsx`

---

## 4. Tribe management (creatable/selectable tribes)

**Type:** Feature
**Priority:** P1

**Description:** Tribes should be first-class entities that admins create and manage. When adding a castaway, the admin selects from existing tribes (not free-text). Scoring can then be done by tribe (e.g., "Winning tribe gets +3 for all members").

**Scope:**
- New `tribes` table: `id, league_id, name, color (optional), created_at`
- Change `castaways.tribe` from text to `tribe_id uuid REFERENCES tribes(id)`
- Admin UI to create/edit/delete tribes
- Castaway form: dropdown selector for tribe instead of free-text input
- Scoring: ability to add events for all castaways in a tribe at once
- Migration to convert existing text tribes to tribe records

**Files likely affected:**
- New migration: `tribes` table + FK on castaways
- `src/app/league/[id]/admin/castaways/page.tsx` (tribe selector)
- New page: `src/app/league/[id]/admin/tribes/page.tsx`
- `src/app/league/[id]/admin/episode/[num]/page.tsx` (tribe-based scoring)
- `src/lib/castaways.ts` (updated types)

---

## 5. Batch episode scoring

**Type:** Feature
**Priority:** P1

**Description:** On the scoring page, admins should be able to select multiple castaways AND multiple scoring rules at once, then submit all combinations as events in one action. Currently you add events one at a time.

**Scope:**
- Multi-select UI for castaways (checkboxes or chip selection)
- Multi-select UI for scoring rules
- "Add Events" button creates N×M events (each selected castaway × each selected rule)
- Preview of what will be created before submission
- Single server action that inserts all events in one batch

**Files likely affected:**
- `src/app/league/[id]/admin/episode/[num]/page.tsx` (major UI rework)
- `src/app/league/[id]/admin/episode/[num]/actions.ts` (new batch action)
- New component: `src/components/batch-scoring-form.tsx`

---

## 6. Tests for all of the above

**Type:** Testing
**Priority:** Alongside each feature

Each feature/bugfix above should include:
- Unit tests in `src/test/` for any new pure logic
- Integration tests in `src/test/integration/` for database operations
- Tests should be written as part of each feature's spec, not as a separate effort

---

## Implementation Order (Recommended)

1. **Trade/leaderboard bug** — Quick fix, unblocks testing other features
2. **Tribe management** — Foundation for tribe-based scoring
3. **Batch episode scoring** — Depends on tribes being entities
4. **Waiver page redesign** — Independent, can be done anytime
5. **Challenge edit/resubmit** — Independent, lowest priority
