"use client";

import { useState } from "react";

export interface CastawayChoice {
  id: string;
  name: string;
  is_eliminated: boolean;
}

interface ChallengeTypeFieldsProps {
  castaways: CastawayChoice[];
  /** Prefix to keep element ids unique when multiple forms render on the page. */
  idPrefix?: string;
  /** Initial challenge type (used by the edit form to seed the current value). */
  initialType?: string;
  /** Initial multiple-choice options (edit form). */
  initialOptions?: string[];
  /** Initial dropdown scope (edit form). */
  initialDropdownScope?: string;
  /** Initial correct answer — option text or castaway id (edit form). */
  initialCorrectAnswer?: string;
}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

/**
 * Client-side, interactive challenge-type configuration fields for the admin
 * challenge form. Renders a challenge-type <select> with no default selected
 * (Req 1.1) and conditionally reveals the inputs each type needs:
 *  - multiple_choice: 2-10 option text inputs with an optional correct-option
 *    selector (Req 2.1, 2.6).
 *  - survivor_dropdown: a scope selector (all / active_only) with an optional
 *    castaway correct-answer <select> sourced from league castaways
 *    (Req 3.1, 3.6).
 *
 * The option text inputs are serialized into a single hidden `options` field as
 * a JSON array so the value is deterministic regardless of how many rows the
 * admin adds. Field names match what createChallengeAction reads from FormData:
 * `challenge_type`, `options`, `dropdown_scope`, `correct_answer`.
 */
export default function ChallengeTypeFields({
  castaways,
  idPrefix = "challenge",
  initialType = "",
  initialOptions,
  initialDropdownScope = "active_only",
  initialCorrectAnswer = "",
}: ChallengeTypeFieldsProps) {
  const [challengeType, setChallengeType] = useState<string>(initialType);
  const [options, setOptions] = useState<string[]>(
    initialOptions && initialOptions.length >= MIN_OPTIONS
      ? initialOptions
      : ["", ""]
  );
  const [correctOption, setCorrectOption] = useState<string>(
    initialType === "multiple_choice" ? initialCorrectAnswer : ""
  );
  const [dropdownScope, setDropdownScope] = useState<string>(initialDropdownScope);

  const trimmedOptions = options.map((o) => o.trim());

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function addOption() {
    setOptions((prev) => (prev.length < MAX_OPTIONS ? [...prev, ""] : prev));
  }

  function removeOption(index: number) {
    setOptions((prev) =>
      prev.length > MIN_OPTIONS ? prev.filter((_, i) => i !== index) : prev
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-type`} className="text-sm font-medium">
          Challenge type
        </label>
        <select
          id={`${idPrefix}-type`}
          name="challenge_type"
          value={challengeType}
          onChange={(e) => setChallengeType(e.target.value)}
          aria-label="Challenge type"
          className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Free response (default)</option>
          <option value="free_response">Free response</option>
          <option value="multiple_choice">Multiple choice</option>
          <option value="survivor_dropdown">Survivor dropdown</option>
        </select>
      </div>

      {challengeType === "multiple_choice" && (
        <fieldset className="space-y-2 rounded border border-border p-3">
          <legend className="text-sm font-medium px-1">Answer options</legend>
          {/* Serialize the option rows into a single deterministic field. */}
          <input
            type="hidden"
            name="options"
            value={JSON.stringify(options)}
          />
          <ul className="space-y-2">
            {options.map((option, index) => (
              <li key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={option}
                  onChange={(e) => updateOption(index, e.target.value)}
                  maxLength={100}
                  aria-label={`Option ${index + 1}`}
                  placeholder={`Option ${index + 1}`}
                  className="flex-1 rounded border border-input bg-background px-3 py-2 text-sm"
                />
                {options.length > MIN_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    aria-label={`Remove option ${index + 1}`}
                    className="rounded border border-destructive text-destructive px-2 py-1 text-xs hover:bg-destructive/10 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {options.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={addOption}
              className="rounded border border-input px-3 py-1 text-xs font-medium hover:bg-muted transition-colors"
            >
              + Add option
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            Enter between {MIN_OPTIONS} and {MAX_OPTIONS} options.
          </p>

          <div>
            <label
              htmlFor={`${idPrefix}-correct-option`}
              className="text-sm font-medium"
            >
              Correct option (optional)
            </label>
            <select
              id={`${idPrefix}-correct-option`}
              name="correct_answer"
              value={correctOption}
              onChange={(e) => setCorrectOption(e.target.value)}
              aria-label="Correct option"
              className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">No correct answer (grade manually)</option>
              {trimmedOptions.map((option, index) =>
                option !== "" ? (
                  <option key={index} value={option}>
                    {option}
                  </option>
                ) : null
              )}
            </select>
          </div>
        </fieldset>
      )}

      {challengeType === "survivor_dropdown" && (
        <fieldset className="space-y-2 rounded border border-border p-3">
          <legend className="text-sm font-medium px-1">Survivor dropdown</legend>
          <div>
            <label
              htmlFor={`${idPrefix}-scope`}
              className="text-sm font-medium"
            >
              Options include
            </label>
            <select
              id={`${idPrefix}-scope`}
              name="dropdown_scope"
              value={dropdownScope}
              onChange={(e) => setDropdownScope(e.target.value)}
              aria-label="Dropdown scope"
              className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="active_only">Active castaways only</option>
              <option value="all">All castaways</option>
            </select>
          </div>

          <div>
            <label
              htmlFor={`${idPrefix}-correct-castaway`}
              className="text-sm font-medium"
            >
              Correct castaway (optional)
            </label>
            <select
              id={`${idPrefix}-correct-castaway`}
              name="correct_answer"
              defaultValue={
                initialType === "survivor_dropdown" ? initialCorrectAnswer : ""
              }
              aria-label="Correct castaway"
              className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">No correct answer (grade manually)</option>
              {castaways
                .filter((c) => dropdownScope === "all" || !c.is_eliminated)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.is_eliminated ? " (eliminated)" : ""}
                  </option>
                ))}
            </select>
          </div>
        </fieldset>
      )}
    </div>
  );
}
