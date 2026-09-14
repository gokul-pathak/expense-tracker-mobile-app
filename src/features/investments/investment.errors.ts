import { ValidationError } from '@/features/shared/errors';

/**
 * Investment refusals a screen has to tell apart.
 *
 * The sentence still passes straight through `getUserErrorMessage`, because both
 * classes extend `ValidationError`. The extra fields are for the screens: "you hold
 * 6 shares", "this change breaks a later sale" and "that account was archived while
 * the form was open" each need different words, and matching on message text is
 * how a copy edit breaks a feature.
 */

/** A change that would leave some sale selling more than was held at that point. */
export class InvestmentHistoryError extends ValidationError {
  constructor(
    message: string,
    readonly heldQuantityMinor: bigint,
    readonly soldQuantityMinor: bigint,
  ) {
    super(message);
  }
}

export type InvestmentValidationCode =
  /** New trades cannot be recorded against an archived asset. */
  | 'asset_archived'
  /** Cash cannot move through an archived account. */
  | 'account_archived'
  /** The account holds another currency, and nothing is converted. */
  | 'currency_mismatch';

export class InvestmentValidationError extends ValidationError {
  constructor(
    readonly code: InvestmentValidationCode,
    message: string,
  ) {
    super(message);
  }
}
