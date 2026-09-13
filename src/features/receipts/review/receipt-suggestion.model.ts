import type {
  CategoryCandidate,
  ExpenseSuggestion,
  ExpenseSuggestionContext,
} from '@/features/ai/expense-suggestion.types';

import type { StoredReceiptDraft } from '../receipt-draft.repository';

import { editReview, type ReceiptReview } from './receipt-review.model';

/**
 * Where Review Receipt meets an AI suggestion — and the only two ways a
 * suggestion can reach the form, both of them a person's tap.
 *
 * A suggestion never selects anything by arriving. `acceptCategorySuggestion`
 * runs when someone taps "Use Food", and from then on the category is an
 * ordinary choice: changing it to Travel is an ordinary edit, and nothing puts
 * Food back.
 */

/**
 * What a receipt contributes to a suggestion request: the merchant candidate
 * the parser read, and nothing else. The amount, date, currency, payment mode,
 * image path, note and account are all on the draft or the form, and none of
 * them is passed on.
 */
export function receiptSuggestionContext(
  draft: Pick<StoredReceiptDraft, 'merchantName'>,
): ExpenseSuggestionContext {
  return { merchantCandidate: draft.merchantName };
}

/** One suggestion per draft. A rescanned receipt is a new draft, with its own. */
export function receiptSuggestionScope(draftId: number): string {
  return `receipt:${draftId}`;
}

export function toCategoryCandidates(
  categories: readonly { id: number; name: string; systemKey: string | null }[],
): CategoryCandidate[] {
  return categories.map(({ id, name, systemKey }) => ({ id, name, systemKey }));
}

/**
 * "Use Food". Sets the category only if it is still offered; otherwise the
 * review is returned unchanged and the person chooses from the picker.
 */
export function acceptCategorySuggestion(
  review: ReceiptReview,
  suggestion: ExpenseSuggestion,
  activeCategoryIds: readonly number[],
): ReceiptReview {
  const { categoryId } = suggestion;
  if (categoryId === null || !activeCategoryIds.includes(categoryId)) return review;
  return editReview(review, 'categoryId', categoryId);
}

/**
 * "Use Suggestion" for the merchant. Only while the field still holds the
 * receipt's own reading: text the person typed is never replaced.
 */
export function acceptMerchantSuggestion(
  review: ReceiptReview,
  suggestion: ExpenseSuggestion,
): ReceiptReview {
  if (suggestion.normalizedMerchant === null || !noteIsReceiptReading(review)) return review;
  return editReview(review, 'note', suggestion.normalizedMerchant);
}

export function noteIsReceiptReading(review: ReceiptReview): boolean {
  return review.fields.note.source === 'receipt';
}
