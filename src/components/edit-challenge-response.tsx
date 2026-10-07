"use client";

import { useState } from "react";
import SubmitButton from "@/components/submit-button";
import { editChallengeResponseAction } from "@/app/league/[id]/challenges/actions";
import type { ChallengeType, CastawayOption } from "@/lib/challenges";

interface EditChallengeResponseProps {
  leagueId: string;
  submissionId: string;
  currentResponse: string;
  challengeType?: ChallengeType;
  options?: string[] | null;
  dropdownOptions?: CastawayOption[];
}

export default function EditChallengeResponse({
  leagueId,
  submissionId,
  currentResponse,
  challengeType = "free_response",
  options,
  dropdownOptions = [],
}: EditChallengeResponseProps) {
  const [isEditing, setIsEditing] = useState(false);

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="text-xs text-primary hover:underline font-medium mt-1"
        aria-label="Edit response"
      >
        Edit
      </button>
    );
  }

  return (
    <form
      action={editChallengeResponseAction}
      className="mt-2 space-y-2"
    >
      <input type="hidden" name="league_id" value={leagueId} />
      <input type="hidden" name="submission_id" value={submissionId} />

      {challengeType === "multiple_choice" ? (
        <fieldset className="space-y-2">
          <legend className="sr-only">Edit your response</legend>
          {(options ?? []).map((option, index) => {
            const optionId = `edit-response-${submissionId}-${index}`;
            return (
              <div key={optionId} className="flex items-center gap-2">
                <input
                  type="radio"
                  id={optionId}
                  name="response"
                  value={option}
                  defaultChecked={option === currentResponse}
                  required
                  className="h-4 w-4 border-input text-primary focus:ring-primary"
                />
                <label htmlFor={optionId} className="text-sm">
                  {option}
                </label>
              </div>
            );
          })}
        </fieldset>
      ) : challengeType === "survivor_dropdown" ? (
        <>
          <label htmlFor={`edit-response-${submissionId}`} className="sr-only">
            Edit your response
          </label>
          <select
            id={`edit-response-${submissionId}`}
            name="response"
            required
            defaultValue={currentResponse}
            className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
            aria-label="Select a castaway"
          >
            <option value="" disabled>
              Select a castaway…
            </option>
            {dropdownOptions.map((castaway) => (
              <option key={castaway.id} value={castaway.id}>
                {castaway.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <label htmlFor={`edit-response-${submissionId}`} className="sr-only">
            Edit your response
          </label>
          <textarea
            id={`edit-response-${submissionId}`}
            name="response"
            required
            rows={2}
            defaultValue={currentResponse}
            className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
            aria-label="Edit your response"
          />
        </>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton
          pendingText="Saving…"
          className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors min-h-[44px] disabled:opacity-50"
        >
          Save
        </SubmitButton>
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          className="rounded border border-input px-4 py-2 text-sm font-medium hover:bg-muted transition-colors min-h-[44px]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
