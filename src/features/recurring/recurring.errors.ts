import { ConflictError, ValidationError } from '@/features/shared/errors';

import type { RecurringBlockedReason } from './recurring.types';

/**
 * Recurring failures carry a code as well as a sentence.
 *
 * The sentence is for a person and passes straight through `getUserErrorMessage`,
 * because these extend the ordinary domain errors. The code is for the screen
 * that M8D builds: "already skipped" and "account archived" need different
 * buttons, and matching on message text is how a copy edit breaks a feature.
 */

export type RecurringConflictCode =
  /** Generating a date that was deliberately skipped. Skipping is not undone implicitly. */
  | 'occurrence_already_skipped'
  /** Skipping a date that already produced a transaction. The transaction is the record. */
  | 'occurrence_already_generated'
  /** A paused template's dates are not generated or skipped until it resumes. */
  | 'template_paused'
  /** The schedule cannot move once any of its dates has been handled. */
  | 'schedule_locked';

export type RecurringValidationCode =
  | 'invalid_date'
  /** A date the schedule never lands on. */
  | 'not_scheduled'
  /** A date that has not arrived yet. M8C generates nothing in advance. */
  | 'future_occurrence'
  /** An end date before a date that was already handled. */
  | 'end_before_handled'
  | RecurringBlockedReason;

export class RecurringConflictError extends ConflictError {
  constructor(
    readonly code: RecurringConflictCode,
    message: string,
  ) {
    super(message);
  }
}

export class RecurringValidationError extends ValidationError {
  constructor(
    readonly code: RecurringValidationCode,
    message: string,
  ) {
    super(message);
  }
}
