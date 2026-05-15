/**
 * Pure challenge logic — no Supabase calls, fully testable.
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.7
 */

export interface Challenge {
  id: string;
  league_id: string;
  episode_id: string;
  title: string;
  description: string | null;
  points: number;
  deadline: string; // ISO timestamp
  created_at: string;
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
