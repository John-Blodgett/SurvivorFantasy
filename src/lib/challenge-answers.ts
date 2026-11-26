/**
 * Builds the "everyone's answers" list shown on closed challenges.
 * Pure functions, no Supabase.
 */

export interface AnswerSubmission {
  challenge_id: string;
  player_id: string;
  response: string;
  is_correct: boolean | null;
}

export interface RevealedAnswer {
  player_id: string;
  player_name: string;
  response: string;
  is_correct: boolean | null;
}

/**
 * Groups submissions by challenge, resolves player names and display text,
 * and sorts each list by player name (case-insensitive).
 *
 * Only challenges in `closedChallengeIds` are included, so answers to open
 * challenges are never revealed.
 */
export function buildRevealedAnswers(
  submissions: AnswerSubmission[],
  closedChallengeIds: Set<string>,
  playerNames: Map<string, string>,
  displayResponse: (challengeId: string, response: string) => string
): Map<string, RevealedAnswer[]> {
  const byChallenge = new Map<string, RevealedAnswer[]>();

  for (const s of submissions) {
    if (!closedChallengeIds.has(s.challenge_id)) continue;
    const list = byChallenge.get(s.challenge_id) ?? [];
    list.push({
      player_id: s.player_id,
      player_name: playerNames.get(s.player_id) ?? "Unknown",
      response: displayResponse(s.challenge_id, s.response),
      is_correct: s.is_correct,
    });
    byChallenge.set(s.challenge_id, list);
  }

  Array.from(byChallenge.values()).forEach((list) =>
    list.sort((a, b) =>
      a.player_name.localeCompare(b.player_name, undefined, { sensitivity: "base" })
    )
  );

  return byChallenge;
}
