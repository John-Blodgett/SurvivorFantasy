/**
 * Pure validation logic for authentication flows.
 * Kept separate from Supabase calls so it can be property-tested without network access.
 */

export interface RegistrationInput {
  email: string;
  password: string;
  displayName: string;
}

export interface RegistrationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a registration attempt against a set of already-registered emails.
 * Returns an error when the email is already taken (Requirements 1.2, 16.1).
 */
export function validateRegistration(
  input: RegistrationInput,
  existingEmails: string[]
): RegistrationResult {
  const normalised = input.email.trim().toLowerCase();

  if (!normalised) {
    return { valid: false, error: "Email is required." };
  }

  if (!input.password || input.password.length < 6) {
    return { valid: false, error: "Password must be at least 6 characters." };
  }

  if (!input.displayName || !input.displayName.trim()) {
    return { valid: false, error: "Display name is required." };
  }

  const isDuplicate = existingEmails.some(
    (e) => e.trim().toLowerCase() === normalised
  );

  if (isDuplicate) {
    return {
      valid: false,
      error: "An account with this email already exists.",
    };
  }

  return { valid: true };
}
