import { describe, expect, it } from 'vitest';

import { prepareExpenseSuggestion } from '@/features/ai/expense-suggestion.service';
import type { CategoryCandidate } from '@/features/ai/expense-suggestion.types';
import { validateSuggestionResponse } from '@/features/ai/expense-suggestion.validation';

/**
 * The app's own check of the server's answer.
 *
 * Every case here is something a server, or the model behind it, could send.
 * The rule under test: a response that breaks any rule is `invalid_response`,
 * and no part of it — not the category, not the merchant, not the reason —
 * reaches the form.
 */

const CATEGORIES: CategoryCandidate[] = [
  { id: 11, name: 'Food', systemKey: 'expense_food' },
  { id: 12, name: 'Shopping', systemKey: 'expense_shopping' },
  { id: 13, name: 'Other', systemKey: 'expense_other' },
];

function prepared(merchant = 'ABC CAFE') {
  const outcome = prepareExpenseSuggestion(
    { merchantCandidate: merchant },
    CATEGORIES,
    'receipt:1',
  );
  if (outcome.kind !== 'ready') throw new Error('expected a request');
  return outcome.prepared;
}

function body(suggestion: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    suggestion: {
      categoryId: 'c1',
      merchantName: 'ABC Café',
      confidence: 'high',
      reason: 'Merchant appears to be a café.',
      ...suggestion,
    },
    requestId: 'req-1',
    provider: 'anthropic',
    model: 'claude-opus-5',
    ...extra,
  };
}

const INVALID = { status: 'failed', reason: 'invalid_response' };

describe('a valid answer', () => {
  it('maps the alias back to this device’s category', () => {
    expect(validateSuggestionResponse(body({}), prepared())).toEqual({
      status: 'suggested',
      suggestion: {
        categoryId: 11,
        normalizedMerchant: 'ABC Café',
        confidence: 'high',
        reason: 'Merchant appears to be a café.',
      },
      meta: { requestId: 'req-1', provider: 'anthropic', model: 'claude-opus-5' },
    });
  });

  it('treats a null category and no merchant as a successful “no suggestion”', () => {
    const result = validateSuggestionResponse(
      body({ categoryId: null, merchantName: null, confidence: 'low', reason: null }),
      prepared(),
    );
    expect(result.status).toBe('no_suggestion');
  });

  it('offers no merchant suggestion that only repeats the receipt', () => {
    const result = validateSuggestionResponse(body({ merchantName: 'abc  cafe' }), prepared());
    expect(result.status === 'suggested' && result.suggestion.normalizedMerchant).toBeNull();
  });

  it('does not offer a hesitant “Other” as a category', () => {
    const result = validateSuggestionResponse(
      body({ categoryId: 'c3', confidence: 'low', merchantName: null }),
      prepared(),
    );
    expect(result.status).toBe('no_suggestion');
  });

  it('keeps a confident “Other”, because that is an answer', () => {
    const result = validateSuggestionResponse(body({ categoryId: 'c3' }), prepared());
    expect(result.status === 'suggested' && result.suggestion.categoryId).toBe(13);
  });

  it('cleans control characters out of plain text rather than rendering them', () => {
    const result = validateSuggestionResponse(
      body({ reason: 'Merchant\u0007 appears to be a café.\u202E' }),
      prepared(),
    );
    expect(result.status === 'suggested' && result.suggestion.reason).toBe(
      'Merchant appears to be a café.',
    );
  });
});

describe('an answer that is refused whole', () => {
  it.each([
    ['a category this request never offered', body({ categoryId: 'c99' })],
    ['a made-up category id', body({ categoryId: 'travel-secret-123' })],
    ['an injected category id', body({ categoryId: 'secret-admin-category' })],
    ['a category given by name', body({ categoryId: 'Food' })],
    ['a confidence outside the scale', body({ confidence: 'certain' })],
    ['a percentage for confidence', body({ confidence: 0.874 })],
    [
      'a missing confidence',
      { ...body({}), suggestion: { categoryId: 'c1', merchantName: null, reason: null } },
    ],
    [
      'a missing reason',
      { ...body({}), suggestion: { categoryId: 'c1', merchantName: null, confidence: 'high' } },
    ],
    ['an extra field', body({ amountMinor: 50_000 })],
    ['an account', body({ accountId: 3 })],
    ['a merchant name longer than 60 characters', body({ merchantName: 'M'.repeat(61) })],
    ['a reason longer than 160 characters', body({ reason: 'R'.repeat(161) })],
    ['markup in the reason', body({ reason: '<script>alert(1)</script>' })],
    ['a link in the merchant', body({ merchantName: 'https://evil.example' })],
    ['a server error body', { status: 'error', code: 'timeout', requestId: 'r' }],
    ['prose instead of JSON', 'I think it is Food'],
    ['nothing', null],
  ])('%s', (_label, response) => {
    expect(validateSuggestionResponse(response, prepared())).toEqual(INVALID);
  });

  it('uses no part of a response whose category is invalid', () => {
    // A model steered into an injected id may have been steered on the name too.
    const result = validateSuggestionResponse(
      body({ categoryId: 'secret-admin-category', merchantName: 'Totally Legit' }),
      prepared(),
    );
    expect(result).toEqual(INVALID);
    expect(JSON.stringify(result)).not.toContain('Totally Legit');
  });
});
