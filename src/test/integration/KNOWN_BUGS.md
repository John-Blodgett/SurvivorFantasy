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

### BUG-002: Waiver processing does not verify drop castaway ownership at processing time

| Field | Value |
|-------|-------|
| **Test file** | `src/test/integration/edge-cases.test.ts` |
| **Test name** | `BUG: should invalidate waiver claim when drop castaway was traded away before processing — Req 8.5` |
| **Expected** | If a player submits a waiver claim dropping Castaway B, then trades Castaway B away before waivers are processed, the claim should be marked "lost" (not "won") because the player no longer owns the drop castaway |
| **Actual** | The claim is marked "won" and the waiver processes successfully, even though the player no longer owns the drop castaway. This could result in a player having more castaways than roster_size allows. |
| **Requirement** | Req 8.5 |
| **Discovered** | 2026-05-14 |
| **Resolution** | The `processWaiverClaims` function needs to verify current ownership of the drop castaway at processing time, not just at submission time |

---

## Resolved Bugs

### BUG-001: episode_events table missing player_id column (RESOLVED)

| Field | Value |
|-------|-------|
| **Resolution** | Applied migration `add_player_id_to_episode_events` adding `player_id uuid REFERENCES profiles(id)` column |
| **Resolved** | 2025-01-13 |
| **Affected requirements** | Req 6.3, 7.8, 10.2 |
