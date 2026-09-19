# Requirements Document

## Introduction

This feature adds configurable challenge types to the Fantasy Survivor app. Today every weekly challenge collects a single free-text response via a textarea, and there is no concept of a challenge "type." This feature lets a League_Admin choose, at challenge creation time, how players answer a challenge:

- **Free response** — a free-text answer (the current behavior).
- **Multiple choice** — a fixed set of admin-defined options; players pick one.
- **Survivor dropdown** — a generated list of the league's castaways; players pick one. The admin decides whether the list contains all castaways in the league or only non-eliminated castaways.

The feature also adds an optional correct-answer concept so multiple-choice and dropdown challenges can be graded against a stored answer, defines how each type is submitted and stored (reusing the existing `challenge_submissions.response` TEXT column), preserves backward compatibility with existing free-response challenges already in the database, and allows an admin to convert an existing challenge (such as "Who is getting the least confessionals in episode 1?") into a survivor dropdown scoped to non-eliminated castaways. Deadline and episode-finalization behavior is unchanged.

## Glossary

- **Challenge_System**: The application subsystem responsible for creating, editing, presenting, submitting, and grading weekly challenges. Encompasses the pure logic in `src/lib/challenges.ts`, the admin server actions in `src/app/league/[id]/admin/episode/[num]/actions.ts`, and the player server actions and page in `src/app/league/[id]/challenges/`.
- **League_Admin**: The user identified as the league's admin (`leagues.admin_id`), who creates, edits, and grades challenges.
- **Player**: A member of a league (`league_members`) who submits responses to challenges.
- **Challenge_Type**: An attribute of a challenge that determines how it is answered. One of `free_response`, `multiple_choice`, or `survivor_dropdown`.
- **Free_Response_Challenge**: A challenge with Challenge_Type `free_response`, answered with free text.
- **Multiple_Choice_Challenge**: A challenge with Challenge_Type `multiple_choice`, answered by selecting one of a fixed set of admin-defined text options.
- **Survivor_Dropdown_Challenge**: A challenge with Challenge_Type `survivor_dropdown`, answered by selecting one castaway from a generated list.
- **Choice_Option**: A single selectable text value for a Multiple_Choice_Challenge, defined by the League_Admin at creation or edit time.
- **Castaway**: A Survivor contestant in the `castaways` table, scoped to a league, with an `is_eliminated` boolean and `eliminated_episode` field.
- **Dropdown_Scope**: A setting on a Survivor_Dropdown_Challenge that determines which castaways appear as options. One of `all` (every castaway in the league) or `active_only` (only castaways where `is_eliminated` is false).
- **Correct_Answer**: An optional stored value on a Multiple_Choice_Challenge or Survivor_Dropdown_Challenge representing the answer that earns points. For multiple choice this is one of the Choice_Options; for a survivor dropdown this is a castaway identifier.
- **Submission**: A row in `challenge_submissions` recording a Player's answer to a challenge (`response` TEXT, `is_correct` boolean or null).
- **Auto_Grade**: The act of the Challenge_System setting `is_correct` on a Submission by comparing the Submission's selected value to the challenge's Correct_Answer, without manual League_Admin action.
- **Deadline**: The timestamp (`challenges.deadline`) after which submissions are closed for a challenge.

## Requirements

### Requirement 1: Select a challenge type at creation

**User Story:** As a League_Admin, I want to choose a challenge type when I create a challenge, so that players answer in the format that fits the question.

#### Acceptance Criteria

1. WHEN the League_Admin opens the challenge creation form, THE Challenge_System SHALL present a Challenge_Type selection listing exactly the options `free_response`, `multiple_choice`, and `survivor_dropdown`, with no option pre-selected.
2. WHERE the League_Admin submits the challenge creation form without selecting a Challenge_Type, THE Challenge_System SHALL set the stored Challenge_Type to `free_response`.
3. WHEN the League_Admin submits the challenge creation form with a Challenge_Type equal to one of `free_response`, `multiple_choice`, or `survivor_dropdown`, THE Challenge_System SHALL persist the challenge with the selected Challenge_Type and confirm creation to the League_Admin.
4. IF the submitted Challenge_Type is not one of `free_response`, `multiple_choice`, or `survivor_dropdown`, THEN THE Challenge_System SHALL reject the creation, persist no challenge record, and return an error message indicating the challenge type is invalid.

### Requirement 2: Configure a multiple-choice challenge

**User Story:** As a League_Admin, I want to define the answer options for a multiple-choice challenge, so that players pick from a fixed list I control.

#### Acceptance Criteria

1. WHERE the Challenge_Type is `multiple_choice`, THE Challenge_System SHALL allow the League_Admin to enter between two and ten Choice_Options, where each Choice_Option has a text value of one to one hundred characters after trimming leading and trailing whitespace.
2. IF the Challenge_Type is `multiple_choice` and fewer than two non-empty Choice_Options are provided after trimming, THEN THE Challenge_System SHALL reject the creation, retain the League_Admin's entered values, and return the error message "A multiple choice challenge requires at least two options."
3. IF the Challenge_Type is `multiple_choice` and two or more Choice_Options have the same text value after trimming and case-insensitive comparison, THEN THE Challenge_System SHALL reject the creation, retain the League_Admin's entered values, and return the error message "Multiple choice options must be unique."
4. IF the Challenge_Type is `multiple_choice` and more than ten Choice_Options are provided, THEN THE Challenge_System SHALL reject the creation, retain the League_Admin's entered values, and return an error message indicating that no more than ten options are allowed.
5. WHEN the League_Admin submits a valid Multiple_Choice_Challenge, THE Challenge_System SHALL store the Choice_Options in the same order they were entered by the League_Admin.
6. WHERE the Challenge_Type is `multiple_choice`, THE Challenge_System SHALL allow the League_Admin to optionally designate exactly one stored Choice_Option as the Correct_Answer.
7. IF the Challenge_Type is `multiple_choice` and the designated Correct_Answer does not match the text value of any provided Choice_Option, THEN THE Challenge_System SHALL reject the creation, retain the League_Admin's entered values, and return an error message indicating that the correct answer must be one of the provided options.

### Requirement 3: Configure a survivor-dropdown challenge

**User Story:** As a League_Admin, I want a challenge whose options are the league's survivors, so that players select a castaway without me typing every name.

#### Acceptance Criteria

1. WHERE the Challenge_Type is `survivor_dropdown`, THE Challenge_System SHALL allow the League_Admin to select a Dropdown_Scope value of exactly one of `all` or `active_only`.
2. WHERE the Challenge_Type is `survivor_dropdown`, IF the League_Admin submits the challenge without selecting a Dropdown_Scope, THEN THE Challenge_System SHALL set the Dropdown_Scope to `active_only`.
3. WHERE the Challenge_Type is `survivor_dropdown` and the Dropdown_Scope is `all`, WHEN a Player opens the Survivor_Dropdown_Challenge, THE Challenge_System SHALL present every Castaway in the league as a selectable option, including those where `is_eliminated` is true.
4. WHERE the Challenge_Type is `survivor_dropdown` and the Dropdown_Scope is `active_only`, WHEN a Player opens the Survivor_Dropdown_Challenge, THE Challenge_System SHALL present only Castaways where `is_eliminated` is false as selectable options.
5. WHEN the League_Admin submits a valid Survivor_Dropdown_Challenge, THE Challenge_System SHALL store the selected Dropdown_Scope with the challenge.
6. WHERE the Challenge_Type is `survivor_dropdown`, THE Challenge_System SHALL allow the League_Admin to designate zero or one Castaway from the league as the Correct_Answer.
7. WHERE the Challenge_Type is `survivor_dropdown`, IF the League_Admin submits a Dropdown_Scope that is not one of `all` or `active_only`, THEN THE Challenge_System SHALL reject the submission, retain the League_Admin's entered values, and display an error message indicating the Dropdown_Scope is invalid.
8. WHERE the Challenge_Type is `survivor_dropdown` and the Dropdown_Scope is `active_only`, IF the League_Admin designates a Castaway where `is_eliminated` is true as the Correct_Answer, THEN THE Challenge_System SHALL reject the submission, retain the League_Admin's entered values, and display an error message indicating the Correct_Answer is not an active Castaway.

### Requirement 4: Present the correct input to players by type

**User Story:** As a Player, I want the challenge to show the right kind of input for its type, so that I can answer it easily.

#### Acceptance Criteria

1. WHERE a challenge is a Free_Response_Challenge, THE Challenge_System SHALL present a single free-text input accepting between 1 and 500 characters for the Player's answer.
2. WHERE a challenge is a Multiple_Choice_Challenge, THE Challenge_System SHALL present each stored Choice_Option as a single-select input where exactly one option may be selected at a time.
3. IF a Multiple_Choice_Challenge has fewer than 2 stored Choice_Options, THEN THE Challenge_System SHALL suppress the input and display an error message indicating the challenge is not answerable.
4. WHERE a challenge is a Survivor_Dropdown_Challenge with Dropdown_Scope `all`, THE Challenge_System SHALL present every Castaway in the league as selectable single-select options.
5. WHERE a challenge is a Survivor_Dropdown_Challenge with Dropdown_Scope `active_only`, THE Challenge_System SHALL present as selectable single-select options only those Castaways whose `is_eliminated` value is false.
6. WHEN a Player opens a Survivor_Dropdown_Challenge for viewing, THE Challenge_System SHALL derive the option list from the Castaway state as it exists at the moment the challenge is opened.
7. IF a Survivor_Dropdown_Challenge resolves to zero selectable Castaways, THEN THE Challenge_System SHALL suppress the input and display an error message indicating no eligible options are available.

### Requirement 5: Validate submissions against the challenge type

**User Story:** As a Player, I want my submission validated against the challenge type, so that only valid answers are accepted.

#### Acceptance Criteria

1. IF a Player submits an answer that is empty or contains only whitespace characters to any challenge, THEN THE Challenge_System SHALL reject the submission, leave any previously recorded Submission unchanged, and return the error message "Response is required."
2. IF a Player submits an answer to a Multiple_Choice_Challenge whose value does not exactly match (case-sensitive) one of the stored Choice_Options, THEN THE Challenge_System SHALL reject the submission, leave any previously recorded Submission unchanged, and return the error message "Selected option is not valid for this challenge."
3. IF a Player submits an answer to a Survivor_Dropdown_Challenge whose value does not match the identifier of a Castaway included in the challenge's Dropdown_Scope, THEN THE Challenge_System SHALL reject the submission, leave any previously recorded Submission unchanged, and return the error message "Selected castaway is not valid for this challenge."
4. WHEN a Player submits a non-empty answer that passes all challenge-type validation checks (criteria 1 through 3) at or before the challenge's Deadline, THE Challenge_System SHALL record the Submission and return a success indication.
5. WHILE the current time is strictly after a challenge's Deadline, THE Challenge_System SHALL reject any new submission or edit to that challenge, leave any previously recorded Submission unchanged, and return the error message "The submission deadline for this challenge has passed."
6. IF a Player submits an answer that references a challenge that does not exist or is not currently open for submissions, THEN THE Challenge_System SHALL reject the submission, record no Submission, and return an error message indicating the challenge is not available for submission.

### Requirement 6: Store the submitted answer consistently

**User Story:** As a developer, I want every submission stored the same way regardless of type, so that grading and display logic stay simple and backward compatible.

#### Acceptance Criteria

1. WHEN the Challenge_System records a Submission for any Challenge_Type, THE Challenge_System SHALL store a non-empty submitted answer value in the existing `challenge_submissions.response` TEXT column.
2. WHERE a Submission is for a Survivor_Dropdown_Challenge, THE Challenge_System SHALL store in `challenge_submissions.response` a single value that uniquely identifies exactly one selected Castaway.
3. WHERE a Submission is for a Multiple_Choice_Challenge, THE Challenge_System SHALL store in `challenge_submissions.response` the text of exactly one selected Choice_Option that matches a defined Choice_Option of the challenge.
4. WHEN the Challenge_System displays a Player's Submission for a Survivor_Dropdown_Challenge, THE Challenge_System SHALL display the selected Castaway's name.
5. IF the Challenge_System attempts to record a Submission for a Multiple_Choice_Challenge or Survivor_Dropdown_Challenge with a value that is empty or does not identify a defined option, THEN THE Challenge_System SHALL reject the Submission and record no Submission.
6. WHEN the Challenge_System displays a Survivor_Dropdown_Challenge Submission whose stored value no longer resolves to an existing Castaway, THE Challenge_System SHALL display the stored `challenge_submissions.response` value without failing.

### Requirement 7: Grade challenges by type

**User Story:** As a League_Admin, I want multiple-choice and dropdown challenges graded against a stored correct answer, so that I do not have to grade every submission by hand.

#### Acceptance Criteria

1. WHERE a Multiple_Choice_Challenge or Survivor_Dropdown_Challenge has a Correct_Answer defined, WHEN a Player submits a Submission, THE Challenge_System SHALL Auto_Grade the Submission by setting `is_correct` to true when the Submission's selected value equals the Correct_Answer under an exact, case-sensitive comparison after trimming leading and trailing whitespace, and to false otherwise.
2. WHERE a Multiple_Choice_Challenge or Survivor_Dropdown_Challenge has no Correct_Answer defined, WHEN a Player submits a Submission, THE Challenge_System SHALL leave `is_correct` as null for manual grading by the League_Admin.
3. WHERE a challenge is a Free_Response_Challenge, WHEN a Player submits a Submission, THE Challenge_System SHALL leave `is_correct` as null until the League_Admin manually grades it.
4. WHEN the League_Admin manually sets `is_correct` on a Submission, THE Challenge_System SHALL persist that value regardless of Challenge_Type and regardless of any prior Auto_Grade result.
5. WHEN computing a Player's challenge points, THE Challenge_System SHALL award a challenge's points for a Submission where `is_correct` is true and SHALL award zero points for a Submission where `is_correct` is false or null.
6. IF the Challenge_System attempts to Auto_Grade a Submission whose selected value does not match any defined Choice_Option or Castaway option of the challenge, THEN THE Challenge_System SHALL reject the Submission, leave any previously recorded Submission unchanged, and return an error indication.

### Requirement 8: Preserve backward compatibility with existing challenges

**User Story:** As a League_Admin with challenges already created, I want existing challenges to keep working, so that this change does not break current data.

#### Acceptance Criteria

1. WHERE a challenge record has a null or absent stored Challenge_Type value, THE Challenge_System SHALL treat that challenge as a Free_Response_Challenge for all scoring, presentation, and submission operations.
2. WHEN the Challenge_System presents a challenge whose stored Challenge_Type value is null or absent, THE Challenge_System SHALL present a single free-text input accepting between 1 and 500 characters.
3. WHEN the Challenge_Type field is introduced by migration, THE Challenge_System SHALL preserve every existing Submission record and its stored `response` and `is_correct` values without modification.
4. IF the migration that introduces the Challenge_Type field fails at any point, THEN THE Challenge_System SHALL roll back all changes so that existing challenge and Submission records remain unchanged, and SHALL surface an error indicating the migration did not complete.
5. WHEN the Challenge_System reads an existing Submission belonging to a challenge with a null or absent Challenge_Type, THE Challenge_System SHALL return the stored `response` and `is_correct` values without transformation.

### Requirement 9: Convert an existing challenge to a survivor dropdown

**User Story:** As a League_Admin, I want to convert the existing "Who is getting the least confessionals in episode 1?" challenge into a survivor dropdown of non-eliminated castaways, so that players choose a castaway instead of typing.

#### Acceptance Criteria

1. WHILE an existing challenge's Deadline has not passed, THE Challenge_System SHALL allow the League_Admin to change that challenge's Challenge_Type.
2. WHEN the League_Admin changes a challenge's Challenge_Type to `survivor_dropdown`, THE Challenge_System SHALL allow the League_Admin to set the Dropdown_Scope to `all` or `active_only`.
3. WHEN the League_Admin saves a challenge converted to `survivor_dropdown` with Dropdown_Scope `active_only`, THE Challenge_System SHALL store the updated Challenge_Type and Dropdown_Scope with the challenge.
4. WHEN a Player opens a challenge that has been converted to `survivor_dropdown` with Dropdown_Scope `active_only`, THE Challenge_System SHALL include every Castaway whose `is_eliminated` value is false and exclude every Castaway whose `is_eliminated` value is true from the selectable options.
5. IF the League_Admin attempts to change the Challenge_Type of a challenge after its Deadline, THEN THE Challenge_System SHALL reject the change, leave the stored Challenge_Type and Dropdown_Scope unchanged, and return the error message "Cannot edit a challenge after its deadline."
6. WHERE the League_Admin converts a challenge to `survivor_dropdown` without selecting a Dropdown_Scope, THE Challenge_System SHALL set the Dropdown_Scope to `active_only`.

### Requirement 10: Preserve deadline and finalization behavior

**User Story:** As a League_Admin, I want deadline and episode-finalization rules to stay the same, so that adding challenge types does not change when submissions close.

#### Acceptance Criteria

1. IF a submission to a challenge is attempted and the challenge's Deadline has passed, THEN THE Challenge_System SHALL reject the submission regardless of Challenge_Type and return an error message indicating that the submission deadline has passed.
2. WHILE the episode associated with a challenge is finalized, THE Challenge_System SHALL reject new submissions to that challenge regardless of Challenge_Type with the error message "This episode has been finalized. No more submissions allowed."
3. WHEN a submission to a challenge is attempted and the current time is strictly before the challenge's Deadline and the associated episode is not finalized, THE Challenge_System SHALL accept the submission regardless of Challenge_Type.
4. WHEN the Challenge_System rejects a submission because the Deadline has passed or the associated episode is finalized, THE Challenge_System SHALL retain all previously accepted submissions to that challenge unchanged.
