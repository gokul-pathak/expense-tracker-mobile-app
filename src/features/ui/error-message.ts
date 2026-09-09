import { ConflictError, NotFoundError, ValidationError } from '@/features/shared/errors';
import { MutationsSuspendedError } from '@/features/sync/sync-lock';

/**
 * The sentence a screen shows when something fails.
 *
 * A domain error already says something useful, so it is passed through. Anything
 * else is unexpected — a missing column, a failed migration, a bug — and gets a
 * plain apology rather than a stack trace. In development the real error is
 * logged, because "Something went wrong" with no way to find out what is the
 * hardest kind of report to act on.
 */
export function getUserErrorMessage(error: unknown): string {
  if (
    error instanceof ValidationError ||
    error instanceof ConflictError ||
    error instanceof NotFoundError ||
    // Saving is briefly held back while cloud setup captures the dataset. That
    // is expected and temporary, and saying so is far better than an apology.
    error instanceof MutationsSuspendedError
  ) {
    return error.message;
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.error(`Unexpected error surfaced to the user: ${describeErrorChain(error)}`);
  }
  return 'Something went wrong. Please try again.';
}

/**
 * The whole chain, not just the outermost wrapper.
 *
 * Database drivers wrap the useful part: "Failed query: commit" says nothing on
 * its own, while its cause names the actual SQLite failure. Anything that has to
 * be diagnosed from a screenshot of a console needs the whole chain on one line.
 */
export function describeErrorChain(error: unknown, depth = 0): string {
  if (depth > 5) return '…';
  if (!(error instanceof Error)) return String(error);

  const details = [`${error.name}: ${error.message}`];
  // Driver errors carry the platform code alongside the message.
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') details.push(`code=${code}`);

  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== null) {
    details.push(`caused by ${describeErrorChain(cause, depth + 1)}`);
  }
  return details.join(' | ');
}
