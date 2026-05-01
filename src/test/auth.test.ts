import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateRegistration } from "@/lib/auth";

// Generators that produce inputs valid enough to reach the duplicate-email check
const validPassword = fc.stringOf(
  fc.char().filter((c) => c.trim().length > 0),
  { minLength: 6, maxLength: 30 }
);
const validDisplayName = fc.stringOf(
  fc.char().filter((c) => c.trim().length > 0),
  { minLength: 1, maxLength: 50 }
);

describe("auth validation", () => {
  // Feature: fantasy-survivor, Property 11: Duplicate email registration is rejected
  // Validates: Requirements 1.2, 16.1
  it("Property 11: duplicate email registration is rejected", () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        validPassword,
        validDisplayName,
        (email, password, displayName) => {
          const existingEmails = [email];

          const result = validateRegistration(
            { email, password, displayName },
            existingEmails
          );

          return (
            result.valid === false &&
            result.error === "An account with this email already exists."
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 11 (case-insensitive): duplicate email is rejected regardless of case", () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        validPassword,
        validDisplayName,
        (email, password, displayName) => {
          // Store the email in uppercase, attempt registration with lowercase
          const existingEmails = [email.toUpperCase()];

          const result = validateRegistration(
            { email: email.toLowerCase(), password, displayName },
            existingEmails
          );

          return (
            result.valid === false &&
            result.error === "An account with this email already exists."
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("allows registration when email is not already taken", () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        validPassword,
        validDisplayName,
        fc.array(fc.emailAddress(), { minLength: 0, maxLength: 10 }),
        (email, password, displayName, otherEmails) => {
          const existingEmails = otherEmails.filter(
            (e) => e.toLowerCase() !== email.toLowerCase()
          );

          const result = validateRegistration(
            { email, password, displayName },
            existingEmails
          );

          return result.valid === true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
