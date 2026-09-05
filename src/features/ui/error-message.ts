import { ConflictError, NotFoundError, ValidationError } from '@/features/shared/errors';

export function getUserErrorMessage(error: unknown): string {
  if (
    error instanceof ValidationError ||
    error instanceof ConflictError ||
    error instanceof NotFoundError
  ) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
