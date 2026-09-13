import type { CloudAuthStatus } from '@/features/cloud-auth/auth.types';
import type { CloudSyncStatus } from '@/features/sync/sync-status';

import type { AiSuggestionPreference } from './ai-preference';
import { canRetrySuggestion, type SuggestionState } from './expense-suggestion.state';
import type { CategoryCandidate, SuggestionConfidence } from './expense-suggestion.types';

/**
 * What a form shows about a suggestion, in words, decided without React.
 *
 * Three rules run through every function here:
 *
 * - **The person's choice wins.** A form with a category chosen shows no
 *   category suggestion at all, and a merchant the person has edited is never
 *   offered a replacement.
 * - **Uncertainty is said, not coloured.** Confidence is a phrase and a
 *   heading ("Possible category"), so it survives a screen reader and a
 *   colour-blind reader alike.
 * - **Failure is quiet.** Every failure ends in the same instruction the form
 *   already implies: choose a category yourself.
 */

export const SUGGESTION_COPY = {
  consentTitle: 'Suggest a category?',
  consentBody:
    'To suggest a category, the merchant name read from this receipt and the names of your expense categories are sent to an AI service. Amounts, dates, accounts, notes and the photo are not sent.',
  consentFootnote: 'You can change this in Settings.',
  consentAccept: 'Suggest a Category',
  consentDecline: 'No Thanks',
  loading: 'Finding a category suggestion…',
  noSuggestion: 'No category suggestion for this receipt. Choose a category.',
  failed: 'Couldn’t get a suggestion. Choose a category manually.',
  rateLimited: 'Category suggestion isn’t available right now. Choose a category manually.',
  signIn: 'AI category suggestions are available when signed in.',
  retry: 'Try Suggestion Again',
} as const;

export type SuggestionAvailability =
  /** Not offered: no cloud project in this build, turned off, or auth still starting. */
  | 'hidden'
  /** Signed in, never asked. Nothing is sent until the person agrees. */
  | 'needs_consent'
  /** Turned on, but no signed-in session to ask with. */
  | 'sign_in_required'
  | 'available';

export function suggestionAvailability(input: {
  configured: boolean;
  preference: AiSuggestionPreference;
  authStatus: CloudAuthStatus;
  syncStatus: CloudSyncStatus;
}): SuggestionAvailability {
  const { configured, preference, authStatus, syncStatus } = input;
  if (!configured || preference === 'disabled') return 'hidden';
  if (authStatus === 'unconfigured' || authStatus === 'initializing') return 'hidden';
  if (authStatus !== 'signed_in') {
    // Someone who never asked for suggestions is not told to sign in for them.
    return preference === 'enabled' ? 'sign_in_required' : 'hidden';
  }
  // This device's records belong to the linked account. Asking under a different
  // signed-in account would spend that account's allowance on another person's
  // receipt, so suggestions wait quietly, as Spending Insights explanations do.
  if (
    syncStatus === 'account_mismatch' ||
    syncStatus === 'reconciliation_required' ||
    syncStatus === 'linking'
  ) {
    return 'hidden';
  }
  return preference === 'enabled' ? 'available' : 'needs_consent';
}

export type CategorySuggestionView =
  | { kind: 'hidden' }
  | { kind: 'loading'; message: string }
  | {
      kind: 'suggestion';
      categoryId: number;
      categoryName: string;
      /** False for low confidence: shown as a possibility, not a recommendation. */
      prominent: boolean;
      title: 'Suggested category' | 'Possible category';
      confidenceLabel: string;
      reason: string | null;
      actionLabel: string;
      actionAccessibilityLabel: string;
      accessibilityLabel: string;
    }
  | { kind: 'message'; message: string; canRetry: boolean };

const CONFIDENCE_LABEL: Record<SuggestionConfidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export function describeCategorySuggestion(
  state: SuggestionState,
  form: { categories: readonly CategoryCandidate[]; selectedCategoryId: number | null },
): CategorySuggestionView {
  // A category chosen by hand — or by accepting — ends the conversation.
  if (form.selectedCategoryId !== null || state.categoryDismissed) return { kind: 'hidden' };

  const { phase } = state;
  switch (phase.status) {
    case 'idle':
    case 'stopped':
      return { kind: 'hidden' };
    case 'loading':
      return { kind: 'loading', message: SUGGESTION_COPY.loading };
    case 'no_suggestion':
      return { kind: 'message', message: SUGGESTION_COPY.noSuggestion, canRetry: false };
    case 'failed':
      switch (phase.reason) {
        case 'cancelled':
        case 'not_configured':
          return { kind: 'hidden' };
        case 'unauthenticated':
          return { kind: 'message', message: SUGGESTION_COPY.signIn, canRetry: false };
        case 'rate_limited':
          return { kind: 'message', message: SUGGESTION_COPY.rateLimited, canRetry: false };
        default:
          return {
            kind: 'message',
            message: SUGGESTION_COPY.failed,
            canRetry: canRetrySuggestion(state),
          };
      }
    case 'ready': {
      const { suggestion } = phase;
      if (suggestion.categoryId === null) {
        return { kind: 'message', message: SUGGESTION_COPY.noSuggestion, canRetry: false };
      }
      // Revalidated on every render: a category archived or deleted since the
      // answer arrived is not offered, even though the answer named it.
      const category = form.categories.find((item) => item.id === suggestion.categoryId);
      if (category === undefined) return { kind: 'hidden' };

      const prominent = suggestion.confidence !== 'low';
      const title = prominent ? 'Suggested category' : 'Possible category';
      return {
        kind: 'suggestion',
        categoryId: category.id,
        categoryName: category.name,
        prominent,
        title,
        confidenceLabel: CONFIDENCE_LABEL[suggestion.confidence],
        reason: suggestion.reason,
        actionLabel: `Use ${category.name}`,
        actionAccessibilityLabel: `Use ${category.name} category`,
        accessibilityLabel: `${title}, ${category.name}, confidence ${suggestion.confidence}.`,
      };
    }
  }
}

export type MerchantSuggestionView =
  | { kind: 'hidden' }
  | { kind: 'suggestion'; detected: string; suggested: string; accessibilityLabel: string };

export function describeMerchantSuggestion(
  state: SuggestionState,
  form: {
    detectedMerchant: string | null;
    /** True only while the field still holds the receipt's own reading, untouched. */
    fieldIsReceiptReading: boolean;
  },
): MerchantSuggestionView {
  const { phase } = state;
  if (phase.status !== 'ready' || state.merchantDismissed) return { kind: 'hidden' };
  const suggested = phase.suggestion.normalizedMerchant;
  if (suggested === null || form.detectedMerchant === null || !form.fieldIsReceiptReading) {
    return { kind: 'hidden' };
  }
  return {
    kind: 'suggestion',
    detected: form.detectedMerchant,
    suggested,
    accessibilityLabel: `Detected merchant, ${form.detectedMerchant}. Suggested merchant, ${suggested}.`,
  };
}
