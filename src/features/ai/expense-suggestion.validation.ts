import { z } from 'zod';

import { normalizeSuggestionText, sameText } from './expense-suggestion.sanitize';
import {
  CONFIDENCE_LEVELS,
  OTHER_EXPENSE_SYSTEM_KEY,
  SUGGESTION_LIMITS,
  type AiExpenseSuggestionResult,
  type CategoryCandidate,
  type PreparedSuggestion,
} from './expense-suggestion.types';

/**
 * The app's own check of what the server sent.
 *
 * The server validated the model's output already. This does it again, because
 * the server is a remote party and the model behind it read text a stranger
 * printed. It runs against the request *this device* prepared, so a category
 * can only ever be one this form offered.
 *
 * All or nothing, like the server: a response that fails any rule is an
 * invalid response, and no field of it is used.
 */

const ALIAS = /^c[1-9][0-9]{0,2}$/;

const responseSchema = z.strictObject({
  status: z.literal('ok'),
  suggestion: z.strictObject({
    categoryId: z.string().regex(ALIAS).nullable(),
    merchantName: z.string().nullable(),
    confidence: z.enum(CONFIDENCE_LEVELS),
    reason: z.string().nullable(),
  }),
  requestId: z.string().max(100),
  provider: z.string().max(40),
  model: z.string().max(100),
});

export function validateSuggestionResponse(
  body: unknown,
  prepared: PreparedSuggestion,
): AiExpenseSuggestionResult {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return invalid();
  const { suggestion, requestId, provider, model } = parsed.data;
  const meta = { requestId, provider, model };

  let category: CategoryCandidate | null = null;
  if (suggestion.categoryId !== null) {
    category = Object.hasOwn(prepared.categories, suggestion.categoryId)
      ? (prepared.categories[suggestion.categoryId] ?? null)
      : null;
    // Not a category this request offered. Never trusted, whatever the server said.
    if (category === null) return invalid();
  }

  const merchant = plainText(suggestion.merchantName, SUGGESTION_LIMITS.outputMerchantMax);
  const reason = plainText(suggestion.reason, SUGGESTION_LIMITS.outputReasonMax);
  if (merchant === undefined || reason === undefined) return invalid();

  // A hesitant "Other" is what a model says when it has nothing to say.
  if (category?.systemKey === OTHER_EXPENSE_SYSTEM_KEY && suggestion.confidence === 'low') {
    category = null;
  }
  // A "cleaner" name identical to what the receipt already says offers nothing.
  const normalizedMerchant =
    merchant !== null && sameText(merchant, prepared.detectedMerchant) ? null : merchant;

  if (category === null && normalizedMerchant === null) return { status: 'no_suggestion', meta };
  return {
    status: 'suggested',
    suggestion: {
      categoryId: category?.id ?? null,
      normalizedMerchant,
      confidence: suggestion.confidence,
      // The reason explains a category. Without one it explains nothing.
      reason: category === null ? null : reason,
    },
    meta,
  };
}

/** `null` for absent or blank, `undefined` for unacceptable. Plain text only. */
function plainText(value: string | null, max: number): string | null | undefined {
  if (value === null) return null;
  const cleaned = normalizeSuggestionText(value);
  if (cleaned === '') return null;
  if (cleaned.length > max) return undefined;
  if (/[<>`]/.test(cleaned) || /(?:https?:\/\/|www\.)\S/i.test(cleaned)) return undefined;
  return cleaned;
}

function invalid(): AiExpenseSuggestionResult {
  return { status: 'failed', reason: 'invalid_response' };
}
