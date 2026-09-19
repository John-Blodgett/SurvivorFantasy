# Implementation Plan: Configurable Challenge Types

## Overview

This plan implements configurable challenge types (`free_response`, `multiple_choice`, `survivor_dropdown`) by first extending the pure logic layer (`src/lib/challenges.ts`) with type/scope/option normalization, config validation, submission validation, dropdown option resolution, and auto-grading — all fully property-tested with `fast-check`. It then adds the backward-compatible migration (`20240018`), wires the admin creation/edit form and server actions to persist the new columns, updates the player page and submit/edit actions to render per-type inputs and auto-grade, and finally extends the integration harness to verify columns, auto-grade, conversion, and backward compatibility against a live database.

Each task builds on the previous ones. The pure lib layer is completed first so the higher layers can consume it; tests are placed close to the code they validate. Property tests reference the design's Correctness Properties (1–18) and the requirement clauses they check.

## Tasks

- [x] 1. Extend pure logic types and normalization in `src/lib/challenges.ts`
  - [x] 1.1 Add typed interfaces and normalization functions
    - Add `ChallengeType` and `DropdownScope` unions, `CHALLENGE_TYPES` constant, and `CastawayOption` interface
    - Extend the `Challenge` interface with nullable `challenge_type`, `options`, `dropdown_scope`, `correct_answer` columns
    - Extend `CreateChallengeInput` with optional `challengeType`, `options`, `dropdownScope`, `correctAnswer` fields
    - Implement `normalizeChallengeType` (null/blank/absent → `free_response`), `normalizeDropdownScope` (null/blank/absent → `active_only`), and `normalizeOptions` (trim, drop empty, preserve order)
    - _Requirements: 1.2, 2.5, 3.2, 8.1, 9.6_

  - [ ]* 1.2 Write property test for challenge-type normalization
    - **Property 1: Missing challenge type normalizes to free_response**
    - **Validates: Requirements 1.2, 8.1**
    - Tag with `// Feature: configurable-challenge-types, Property 1: ...`, run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

  - [ ]* 1.3 Write property test for dropdown-scope normalization
    - **Property 9: Missing dropdown scope normalizes to active_only**
    - **Validates: Requirements 3.2, 9.6**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

  - [ ]* 1.4 Write property test for option-order preservation
    - **Property 7: Option order is preserved**
    - **Validates: Requirements 2.5**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

- [x] 2. Implement create/edit config validation and dropdown option resolution
  - [x] 2.1 Implement `validateChallengeConfig(input, castaways)` in `src/lib/challenges.ts`
    - Compose existing `validateCreateChallenge` for shared title/points/deadline checks, then layer type-specific rules
    - Reject unknown challenge type (Req 1.4); MC: 2–10 options, each 1–100 chars trimmed, unique under trim + case-insensitive, correct answer must be an option; dropdown: valid scope enum, `active_only` correct answer must be a non-eliminated castaway
    - Return the exact required error messages defined in the design's Error Handling section
    - _Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 3.1, 3.6, 3.7, 3.8_

  - [x] 2.2 Implement `resolveDropdownOptions(scope, castaways)` in `src/lib/challenges.ts`
    - `all` → full castaway set; `active_only` → castaways where `is_eliminated` is false; preserve input order
    - _Requirements: 3.3, 3.4, 4.4, 4.5, 4.6, 9.4_

  - [ ]* 2.3 Write property test for unknown-type rejection
    - **Property 2: Unknown challenge type is rejected**
    - **Validates: Requirements 1.4**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

  - [ ]* 2.4 Write property test for valid multiple-choice config acceptance
    - **Property 3: Valid multiple-choice configuration is accepted**
    - **Validates: Requirements 2.1**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

  - [ ]* 2.5 Write property test for too-few options rejection
    - **Property 4: Too-few multiple-choice options are rejected**
    - **Validates: Requirements 2.2**
    - Assert exact message "A multiple choice challenge requires at least two options."; run `{ numRuns: 100 }`

  - [ ]* 2.6 Write property test for duplicate options rejection
    - **Property 5: Duplicate multiple-choice options are rejected**
    - **Validates: Requirements 2.3**
    - Assert exact message "Multiple choice options must be unique."; run `{ numRuns: 100 }`

  - [ ]* 2.7 Write property test for too-many options rejection
    - **Property 6: Too-many multiple-choice options are rejected**
    - **Validates: Requirements 2.4**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

  - [ ]* 2.8 Write property test for MC correct-answer membership
    - **Property 8: Multiple-choice correct answer must be one of the options**
    - **Validates: Requirements 2.7**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

  - [ ]* 2.9 Write property test for invalid dropdown-scope rejection
    - **Property 10: Invalid dropdown scope is rejected**
    - **Validates: Requirements 3.7**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

  - [ ]* 2.10 Write property test for dropdown option resolution
    - **Property 11: Dropdown option resolution matches scope**
    - **Validates: Requirements 3.3, 3.4, 4.4, 4.5, 4.6, 9.4**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

  - [ ]* 2.11 Write property test for active_only correct-answer validation
    - **Property 12: Dropdown active_only correct answer must be an active castaway**
    - **Validates: Requirements 3.8**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

- [x] 3. Implement submission validation, auto-grade, and display resolution
  - [x] 3.1 Implement `validateTypedSubmission(input)` in `src/lib/challenges.ts`
    - Reject whitespace-only responses for every type with "Response is required."; MC must exactly (case-sensitive) match a stored option else "Selected option is not valid for this challenge."; dropdown must match a scoped castaway id else "Selected castaway is not valid for this challenge."
    - On success return the normalized storable `value` (trimmed text / option text / castaway id)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.5_

  - [x] 3.2 Implement `autoGrade(input)` in `src/lib/challenges.ts`
    - Exact, case-sensitive, trimmed comparison; `is_correct=true`/`false` when a correct answer is defined, `null` when none
    - _Requirements: 7.1, 7.2, 7.3, 7.6_

  - [x] 3.3 Implement dropdown display resolver in `src/lib/challenges.ts`
    - Resolve a stored response value to a castaway name; fall back to the raw stored value if unresolved; never throw
    - _Requirements: 6.4, 6.6_

  - [ ]* 3.4 Write property test for empty/whitespace submission rejection
    - **Property 13: Empty or whitespace answers are rejected for every type**
    - **Validates: Requirements 5.1**
    - Assert exact message "Response is required."; run `{ numRuns: 100 }`

  - [ ]* 3.5 Write property test for MC submission matching
    - **Property 14: Multiple-choice submissions must exactly match a stored option**
    - **Validates: Requirements 5.2, 6.5**
    - Assert exact message "Selected option is not valid for this challenge."; run `{ numRuns: 100 }`

  - [ ]* 3.6 Write property test for dropdown submission matching
    - **Property 15: Survivor-dropdown submissions must match a scoped castaway id**
    - **Validates: Requirements 5.3, 6.5**
    - Assert exact message "Selected castaway is not valid for this challenge."; run `{ numRuns: 100 }`

  - [ ]* 3.7 Write property test for valid storable value
    - **Property 16: A valid submission returns the correct storable value**
    - **Validates: Requirements 5.4, 6.1, 6.2, 6.3**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

  - [ ]* 3.8 Write property test for auto-grade comparison
    - **Property 17: Auto-grade is exact, case-sensitive, and trimmed**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.6**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

  - [ ]* 3.9 Write property test for safe display resolution
    - **Property 18: Dropdown display resolution falls back safely**
    - **Validates: Requirements 6.6**
    - Run `{ numRuns: 100 }` in `src/test/challenges.test.ts`

  - [ ]* 3.10 Write unit/example tests for lib affordances
    - Valid config of each type accepted; legacy read returns stored values unchanged
    - _Requirements: 1.3, 3.1, 3.6, 8.5, 9.1, 9.2_

- [x] 4. Checkpoint - Ensure all pure-logic tests pass
  - Run `npm run test`. Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add backward-compatible database migration
  - [x] 5.1 Create `supabase/migrations/20240018_add_challenge_types.sql`
    - In a single `BEGIN/COMMIT` transaction, `ALTER TABLE challenges` to add `challenge_type text NOT NULL DEFAULT 'free_response'` with a CHECK constraint, nullable `options jsonb`, `dropdown_scope text` with a CHECK constraint, and nullable `correct_answer text`
    - Do not write any `challenge_submissions` row; include the reversible down-migration SQL as a comment block
    - _Requirements: 8.1, 8.3, 8.4_

- [x] 6. Wire admin creation/edit to persist typed challenges
  - [x] 6.1 Extend `createChallengeAction` in `src/app/league/[id]/admin/episode/[num]/actions.ts`
    - Read `challenge_type`, `options`, `dropdown_scope`, `correct_answer` from FormData; fetch league castaways; call `validateChallengeConfig`; on failure `redirect(...?error=)` with no insert; on success normalize and insert the new columns (`free_response` stores nulls)
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.5, 3.6, 3.7, 3.8_

  - [x] 6.2 Extend `updateChallengeAction` for edit and type conversion
    - Load the challenge; if `deadline < now` redirect with "Cannot edit a challenge after its deadline." leaving the row unchanged; otherwise validate config like create and update the type/options/scope/correct_answer columns
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6_

  - [x] 6.3 Update the admin form in `src/app/league/[id]/admin/episode/[num]/page.tsx`
    - Add a type `<select>` with no default pre-selected; conditionally render MC option inputs (2–10) with an optional correct-option selector, and a dropdown scope selector with an optional castaway correct-answer `<select>` sourced from league castaways
    - _Requirements: 1.1, 2.1, 2.6, 3.1, 3.6_

- [x] 7. Wire player page and submit/edit actions
  - [x] 7.1 Extend `submitChallengeResponseAction` in `src/app/league/[id]/challenges/actions.ts`
    - Preserve existing membership/deadline/finalization/duplicate guards; fetch challenge type/options/scope/correct_answer (plus castaways for dropdowns); call `validateTypedSubmission` (redirect with exact message on failure); compute `is_correct` via `autoGrade`; insert `{ response: value, is_correct }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.5, 7.1, 7.2, 7.3, 7.6, 10.1, 10.2, 10.3, 10.4_

  - [x] 7.2 Extend `editChallengeResponseAction` to re-run typed validation and auto-grade
    - Re-run `validateTypedSubmission` + `autoGrade`; keep the existing rule that edit is blocked once the submission is graded
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 9.5_

  - [x] 7.3 Update the player page in `src/app/league/[id]/challenges/page.tsx`
    - Replace the single textarea with a per-type renderer: free-response textarea (incl. null/absent type), MC radio group (suppress + "This challenge is not answerable." when <2 options), dropdown `<select>` from `resolveDropdownOptions` (suppress + "No eligible options are available." when empty); resolve existing dropdown submissions to castaway names with raw-value fallback
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.4, 6.6, 8.2_

- [x] 8. Checkpoint - Ensure the app builds and tests pass
  - Run `npm run validate` (test + lint + build). Ensure all pass, ask the user if questions arise.

- [x] 9. Extend integration test harness and add integration coverage
  - [x] 9.1 Extend integration helpers in `src/test/integration/helpers/actions.ts`
    - Add optional typed params to `createChallenge`; extend `submitChallengeResponse` to run `validateTypedSubmission` + `autoGrade`; add `updateChallenge(challengeId, patch)` mirroring `updateChallengeAction`; keep `gradeSubmission` unchanged
    - _Requirements: 1.2, 1.3, 5.6, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 9.1, 9.2, 9.3, 9.5, 10.2, 10.3, 10.4_

  - [ ]* 9.2 Add typed-challenge integration tests in `src/test/integration/challenges.test.ts`
    - Cover create/persist of each type + ordered options, response storage mapping, auto-grade true/false/null, manual override wins, closed/non-existent submit, conversion before/after deadline, finalization, and end-to-end leaderboard points
    - _Requirements: 1.2, 1.3, 2.5, 3.1, 3.5, 5.6, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 9.1, 9.2, 9.3, 9.5, 10.2, 10.3, 10.4_

  - [ ]* 9.3 Add backward-compatibility and migration smoke tests
    - Insert a pre-migration-style row read/submitted as free response with unchanged existing submission values; verify the four new columns/defaults exist and no `challenge_submissions` row was modified
    - _Requirements: 8.1, 8.3, 8.4, 8.5_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Run `npm run validate` and `npm run test:integration`. Ensure all pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP.
- Each task references specific granular requirement clauses for traceability.
- Checkpoints ensure incremental validation at layer boundaries.
- Property tests validate the design's Correctness Properties 1–18; each runs `{ numRuns: 100 }` and is tagged with its property number and validated requirements, per the design Testing Strategy.
- Unit and integration tests cover UI rendering, persistence, migration, RLS, and finalization behavior that are not suitable for property-based testing.
- The existing deadline property (`validateChallengeSubmission`) and `computeChallengePoints` property already cover Req 5.5/9.5/10.1 and 7.5 respectively; no new PBT is added for those.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.1", "2.2", "3.1", "3.2", "3.3", "5.1"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "2.11", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10"] },
    { "id": 3, "tasks": ["6.1", "6.3", "7.1", "7.3", "9.1"] },
    { "id": 4, "tasks": ["6.2", "7.2"] },
    { "id": 5, "tasks": ["9.2", "9.3"] }
  ]
}
```
