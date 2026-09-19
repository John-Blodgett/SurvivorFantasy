/**
 * Pure challenge logic — no Supabase calls, fully testable.
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.7
 */

/**
 * The way a challenge is answered.
 * - `free_response`: free-text answer (legacy/default behavior).
 * - `multiple_choice`: pick one of a fixed set of admin-defined options.
 * - `survivor_dropdown`: pick one castaway from a generated list.
 * Requirements: 1.1
 */
export type ChallengeType =
  | "free_response"
  | "multiple_choice"
  | "survivor_dropdown";

/**
 * Which castaways appear as options for a survivor-dropdown challenge.
 * - `all`: every castaway in the league.
 * - `active_only`: only castaways where `is_eliminated` is false.
 * Requirements: 3.1
 */
export type DropdownScope = "all" | "active_only";

/**
 * The exact set of valid challenge types, in presentation order.
 * Requirements: 1.1
 */
export const CHALLENGE_TYPES: readonly ChallengeType[] = [
  "free_response",
  "multiple_choice",
  "survivor_dropdown",
];

/**
 * Minimal castaway shape the pure lib needs (no Supabase types leak in).
 */
export interface CastawayOption {
  id: string;
  name: string;
  is_eliminated: boolean;
}

export interface Challenge {
  id: string;
  league_id: string;
  episode_id: string;
  title: string;
  description: string | null;
  points: number;
  deadline: string; // ISO timestamp
  created_at: string;
  // Columns added by migration; all nullable for backward compatibility.
  challenge_type: ChallengeType | null; // null/absent => treated as free_response (Req 8.1)
  options: string[] | null; // multiple_choice only
  dropdown_scope: DropdownScope | null; // survivor_dropdown only
  correct_answer: string | null; // MC: option text; dropdown: castaway id
}

export interface ChallengeSubmission {
  id: string;
  challenge_id: string;
  player_id: string;
  response: string;
  is_correct: boolean | null;
  submitted_at: string;
}

export interface CreateChallengeInput {
  title: string;
  description: string;
  points: number;
  deadline: string; // ISO timestamp
  // New optional fields — omission implies free_response (Req 1.2).
  challengeType?: string; // raw from FormData; validated/normalized
  options?: string[]; // MC raw option strings
  dropdownScope?: string; // raw scope string
  correctAnswer?: string | null; // MC option text OR castaway id
}

export interface ChallengeValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates challenge creation input.
 * Requirements: 9.1
 */
export function validateCreateChallenge(
  input: CreateChallengeInput
): ChallengeValidationResult {
  if (!input.title || !input.title.trim()) {
    return { valid: false, error: "Challenge title is required." };
  }

  if (!input.points || input.points <= 0) {
    return { valid: false, error: "Points must be a positive number." };
  }

  if (!input.deadline) {
    return { valid: false, error: "Deadline is required." };
  }

  const deadlineDate = new Date(input.deadline);
  if (isNaN(deadlineDate.getTime())) {
    return { valid: false, error: "Invalid deadline date." };
  }

  return { valid: true };
}

/**
 * Validates a challenge submission.
 * Returns an error if the submission is after the deadline.
 * Requirements: 9.3
 */
export function validateChallengeSubmission(
  submittedAt: Date,
  deadline: Date
): ChallengeValidationResult {
  if (submittedAt > deadline) {
    return { valid: false, error: "The submission deadline for this challenge has passed." };
  }

  return { valid: true };
}

/**
 * Validates an edit/resubmit of a challenge response.
 * Rules: response must be non-empty, deadline must not have passed,
 * and the submission must not already be graded.
 * Requirements: 9.3
 */
export function validateEditResponse(input: {
  response: string;
  deadline: string;
  isGraded: boolean;
}): ChallengeValidationResult {
  if (!input.response || !input.response.trim()) {
    return { valid: false, error: "Response cannot be empty." };
  }

  const deadlineDate = new Date(input.deadline);
  if (new Date() > deadlineDate) {
    return { valid: false, error: "The submission deadline for this challenge has passed." };
  }

  if (input.isGraded) {
    return { valid: false, error: "Cannot edit a response that has already been graded." };
  }

  return { valid: true };
}

/**
 * Computes challenge points for a player.
 * Only correct submissions (is_correct === true) earn points.
 * Requirements: 9.4
 */
export function computeChallengePoints(
  submissions: Array<{ points: number; is_correct: boolean | null }>
): number {
  return submissions
    .filter((s) => s.is_correct === true)
    .reduce((sum, s) => sum + s.points, 0);
}

/**
 * Normalizes a raw challenge-type value.
 * A null, undefined, or blank-after-trimming value resolves to `free_response`.
 * Any other value (including unknown strings) is returned trimmed as-is, so
 * that config validation can reject unknown types explicitly.
 * Requirements: 1.2, 8.1
 */
export function normalizeChallengeType(
  raw: string | null | undefined
): ChallengeType {
  if (raw === null || raw === undefined) {
    return "free_response";
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    return "free_response";
  }

  return trimmed as ChallengeType;
}

/**
 * Normalizes a raw dropdown-scope value.
 * A null, undefined, or blank-after-trimming value resolves to `active_only`.
 * Any other value is returned trimmed as-is, so that config validation can
 * reject unknown scopes explicitly.
 * Requirements: 3.2, 9.6
 */
export function normalizeDropdownScope(
  raw: string | null | undefined
): DropdownScope {
  if (raw === null || raw === undefined) {
    return "active_only";
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    return "active_only";
  }

  return trimmed as DropdownScope;
}

/**
 * Normalizes a raw list of multiple-choice options: trims each entry, drops
 * entries that are empty after trimming, and preserves the original order of
 * the remaining entries.
 * Requirements: 2.1, 2.5
 */
export function normalizeOptions(raw: string[]): string[] {
  return raw
    .map((option) => option.trim())
    .filter((option) => option !== "");
}

/**
 * Validates a challenge create/edit configuration.
 *
 * Composes `validateCreateChallenge` for the shared title/points/deadline
 * checks, then layers type-specific rules:
 * - Unknown challenge type is rejected (Req 1.4).
 * - multiple_choice: 2–10 options, each 1–100 chars after trimming, unique
 *   under trim + case-insensitive comparison; an optional correct answer must
 *   equal one of the provided options (Req 2.1–2.4, 2.6, 2.7).
 * - survivor_dropdown: scope must be a valid enum; when scope is `active_only`
 *   an optional correct-answer castaway id must reference a non-eliminated
 *   castaway (Req 3.1, 3.6, 3.7, 3.8).
 *
 * Pure: castaway state is passed in rather than looked up.
 * Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 3.1, 3.6, 3.7, 3.8
 */
export function validateChallengeConfig(
  input: CreateChallengeInput,
  castaways: CastawayOption[]
): ChallengeValidationResult {
  // Shared title/points/deadline checks first.
  const base = validateCreateChallenge(input);
  if (!base.valid) {
    return base;
  }

  // Resolve the type; an absent/blank type is free_response (Req 1.2).
  const type = normalizeChallengeType(input.challengeType);

  // Reject any type that is not one of the known challenge types (Req 1.4).
  if (!CHALLENGE_TYPES.includes(type)) {
    return { valid: false, error: "Invalid challenge type." };
  }

  if (type === "free_response") {
    return { valid: true };
  }

  if (type === "multiple_choice") {
    const normalized = normalizeOptions(input.options ?? []);

    // At least two non-empty options (Req 2.2).
    if (normalized.length < 2) {
      return {
        valid: false,
        error: "A multiple choice challenge requires at least two options.",
      };
    }

    // No more than ten options (Req 2.4).
    if (normalized.length > 10) {
      return {
        valid: false,
        error: "A multiple choice challenge allows no more than ten options.",
      };
    }

    // Each option must be 1–100 characters after trimming (Req 2.1).
    for (const option of normalized) {
      if (option.length > 100) {
        return {
          valid: false,
          error: "Each option must be no more than 100 characters.",
        };
      }
    }

    // Unique under trim + case-insensitive comparison (Req 2.3).
    const seen = new Set<string>();
    for (const option of normalized) {
      const key = option.toLowerCase();
      if (seen.has(key)) {
        return {
          valid: false,
          error: "Multiple choice options must be unique.",
        };
      }
      seen.add(key);
    }

    // Optional correct answer must match one of the provided options (Req 2.6, 2.7).
    if (input.correctAnswer !== null && input.correctAnswer !== undefined) {
      const trimmedCorrect = input.correctAnswer.trim();
      if (trimmedCorrect !== "" && !normalized.includes(trimmedCorrect)) {
        return {
          valid: false,
          error: "The correct answer must be one of the provided options.",
        };
      }
    }

    return { valid: true };
  }

  // survivor_dropdown
  const scope = normalizeDropdownScope(input.dropdownScope);

  // Scope must be a valid enum value (Req 3.7).
  if (scope !== "all" && scope !== "active_only") {
    return { valid: false, error: "Invalid dropdown scope." };
  }

  // Optional correct answer: when scope is active_only, it must reference a
  // non-eliminated castaway (Req 3.6, 3.8).
  if (input.correctAnswer !== null && input.correctAnswer !== undefined) {
    const trimmedCorrect = input.correctAnswer.trim();
    if (trimmedCorrect !== "" && scope === "active_only") {
      const match = castaways.find((c) => c.id === trimmedCorrect);
      if (match && match.is_eliminated) {
        return {
          valid: false,
          error: "The correct answer must be an active castaway.",
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Resolves the selectable castaway options for a survivor-dropdown challenge
 * from live castaway state.
 * - `all` → the full castaway set.
 * - `active_only` → castaways where `is_eliminated` is false.
 * Input order is preserved.
 * Requirements: 3.3, 3.4, 4.4, 4.5, 4.6, 9.4
 */
export function resolveDropdownOptions(
  scope: DropdownScope,
  castaways: CastawayOption[]
): CastawayOption[] {
  if (scope === "all") {
    return [...castaways];
  }

  return castaways.filter((c) => !c.is_eliminated);
}

/**
 * Validates a player submission against the challenge type and returns the
 * normalized storable value on success.
 * - Any type: a whitespace-only (or empty) response is rejected with
 *   "Response is required." (Req 5.1).
 * - multiple_choice: the response must exactly (case-sensitive) match one of
 *   the stored options, else "Selected option is not valid for this
 *   challenge." (Req 5.2, 6.5). Stored value is the matched option text.
 * - survivor_dropdown: the response must match the id of a castaway included
 *   in the resolved scope, else "Selected castaway is not valid for this
 *   challenge." (Req 5.3, 6.5). Stored value is the castaway id.
 * - free_response: stored value is the trimmed text (Req 6.1).
 * Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.5
 */
export function validateTypedSubmission(input: {
  type: ChallengeType;
  rawResponse: string;
  options: string[] | null;
  scope: DropdownScope | null;
  castaways: CastawayOption[];
}): ChallengeValidationResult & { value?: string } {
  const raw = input.rawResponse ?? "";
  const trimmed = raw.trim();

  // Empty/whitespace-only rejected for every type (Req 5.1).
  if (trimmed === "") {
    return { valid: false, error: "Response is required." };
  }

  if (input.type === "multiple_choice") {
    const options = input.options ?? [];
    // Exact, case-sensitive match against a stored option (Req 5.2, 6.5).
    if (!options.includes(trimmed)) {
      return {
        valid: false,
        error: "Selected option is not valid for this challenge.",
      };
    }
    return { valid: true, value: trimmed };
  }

  if (input.type === "survivor_dropdown") {
    const scope = input.scope ?? "active_only";
    const eligible = resolveDropdownOptions(scope, input.castaways);
    // Must match the id of a castaway in the resolved scope (Req 5.3, 6.5).
    if (!eligible.some((c) => c.id === trimmed)) {
      return {
        valid: false,
        error: "Selected castaway is not valid for this challenge.",
      };
    }
    return { valid: true, value: trimmed };
  }

  // free_response — store the trimmed text (Req 6.1).
  return { valid: true, value: trimmed };
}

/**
 * Auto-grades a submission by comparing its value to the challenge's correct
 * answer under an exact, case-sensitive comparison after trimming.
 * - Returns `is_correct = null` when no correct answer is defined (Req 7.2, 7.3).
 * - Returns `true`/`false` otherwise (Req 7.1).
 * Requirements: 7.1, 7.2, 7.3, 7.6
 */
export function autoGrade(input: {
  submittedValue: string;
  correctAnswer: string | null;
}): { is_correct: boolean | null } {
  if (input.correctAnswer === null || input.correctAnswer === undefined) {
    return { is_correct: null };
  }

  const trimmedCorrect = input.correctAnswer.trim();
  if (trimmedCorrect === "") {
    return { is_correct: null };
  }

  const trimmedSubmitted = (input.submittedValue ?? "").trim();
  return { is_correct: trimmedSubmitted === trimmedCorrect };
}

/**
 * Resolves a stored survivor-dropdown submission value (a castaway id) to a
 * display name. Falls back to the raw stored value when the id no longer
 * resolves to an existing castaway. Never throws.
 * Requirements: 6.4, 6.6
 */
export function resolveDropdownDisplay(
  storedValue: string,
  castaways: CastawayOption[]
): string {
  const match = castaways.find((c) => c.id === storedValue);
  return match ? match.name : storedValue;
}
