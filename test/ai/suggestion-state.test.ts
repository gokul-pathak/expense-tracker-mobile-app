import { describe, expect, it } from 'vitest';

import { parseAiSuggestionPreference } from '@/features/ai/ai-preference';
import {
  describeCategorySuggestion,
  describeMerchantSuggestion,
  SUGGESTION_COPY,
  suggestionAvailability,
} from '@/features/ai/expense-suggestion.presentation';
import {
  initialSuggestionState,
  MAX_SUGGESTION_ATTEMPTS,
  suggestionReducer,
  type SuggestionEvent,
  type SuggestionState,
} from '@/features/ai/expense-suggestion.state';
import type {
  AiExpenseSuggestionResult,
  CategoryCandidate,
  ExpenseSuggestion,
} from '@/features/ai/expense-suggestion.types';

/**
 * A suggestion's life beside a form, and what the form shows about it.
 *
 * The screen renders these values and nothing else, so the milestone's UI
 * rules — suggest, don't preselect; the person wins; a late answer changes
 * nothing; a failure is quiet — are asserted here, without a phone.
 */

const CATEGORIES: CategoryCandidate[] = [
  { id: 11, name: 'Food', systemKey: 'expense_food' },
  { id: 12, name: 'Shopping', systemKey: 'expense_shopping' },
];

const META = { requestId: 'r', provider: 'anthropic', model: 'claude-opus-5' };

function suggested(overrides: Partial<ExpenseSuggestion> = {}): AiExpenseSuggestionResult {
  return {
    status: 'suggested',
    suggestion: {
      categoryId: 11,
      normalizedMerchant: null,
      confidence: 'high',
      reason: 'Merchant appears to be a café.',
      ...overrides,
    },
    meta: META,
  };
}

function play(...events: SuggestionEvent[]): SuggestionState {
  return events.reduce(suggestionReducer, initialSuggestionState);
}

describe('requests', () => {
  it('asks once per draft context, however often the form renders or refocuses', () => {
    const loading = play({ type: 'request', fingerprint: 'A' });
    expect(loading.phase).toEqual({ status: 'loading', fingerprint: 'A' });
    expect(suggestionReducer(loading, { type: 'request', fingerprint: 'A' })).toBe(loading);

    const answered = suggestionReducer(loading, {
      type: 'finished',
      run: loading.run,
      fingerprint: 'A',
      result: suggested(),
    });
    expect(suggestionReducer(answered, { type: 'request', fingerprint: 'A' })).toBe(answered);
  });

  it('never retries a failure by itself', () => {
    const failed = play(
      { type: 'request', fingerprint: 'A' },
      {
        type: 'finished',
        run: 1,
        fingerprint: 'A',
        result: { status: 'failed', reason: 'timeout' },
      },
    );
    expect(failed.phase.status).toBe('failed');
    expect(suggestionReducer(failed, { type: 'request', fingerprint: 'A' })).toBe(failed);
  });

  it('retries only when asked, only for failures a retry could fix, and only a few times', () => {
    const timeout = { status: 'failed', reason: 'timeout' } as const;
    let state = play({ type: 'request', fingerprint: 'A' });
    for (let attempt = 1; attempt < MAX_SUGGESTION_ATTEMPTS; attempt += 1) {
      state = suggestionReducer(state, {
        type: 'finished',
        run: state.run,
        fingerprint: 'A',
        result: timeout,
      });
      state = suggestionReducer(state, { type: 'retry', fingerprint: 'A' });
      expect(state.phase.status).toBe('loading');
    }
    state = suggestionReducer(state, {
      type: 'finished',
      run: state.run,
      fingerprint: 'A',
      result: timeout,
    });
    // The ceiling. No retry storm, whatever the button is pressed.
    expect(suggestionReducer(state, { type: 'retry', fingerprint: 'A' })).toBe(state);
    expect(state.attempts).toBe(MAX_SUGGESTION_ATTEMPTS);

    const limited = play(
      { type: 'request', fingerprint: 'B' },
      {
        type: 'finished',
        run: 1,
        fingerprint: 'B',
        result: { status: 'failed', reason: 'rate_limited' },
      },
    );
    expect(suggestionReducer(limited, { type: 'retry', fingerprint: 'B' })).toBe(limited);
  });

  it('never shows receipt A’s late answer on receipt B', () => {
    const a = play({ type: 'request', fingerprint: 'receipt-A' });
    const b = suggestionReducer(a, { type: 'request', fingerprint: 'receipt-B' });

    // A returns last, carrying its old run.
    const lateA = suggestionReducer(b, {
      type: 'finished',
      run: a.run,
      fingerprint: 'receipt-A',
      result: suggested({ categoryId: 12 }),
    });
    expect(lateA).toBe(b);

    const answeredB = suggestionReducer(b, {
      type: 'finished',
      run: b.run,
      fingerprint: 'receipt-B',
      result: suggested({ categoryId: 11 }),
    });
    expect(answeredB.phase).toMatchObject({ status: 'ready', fingerprint: 'receipt-B' });
    expect(answeredB.phase.status === 'ready' && answeredB.phase.suggestion.categoryId).toBe(11);
  });

  it('drops an answer that arrives after Save Expense, and asks nothing more', () => {
    const loading = play({ type: 'request', fingerprint: 'A' });
    const saved = suggestionReducer(loading, { type: 'cancel' });

    const late = suggestionReducer(saved, {
      type: 'finished',
      run: loading.run,
      fingerprint: 'A',
      result: suggested(),
    });
    expect(late).toBe(saved);
    expect(saved.phase.status).toBe('stopped');
    expect(suggestionReducer(saved, { type: 'request', fingerprint: 'A' })).toBe(saved);
  });

  it('has no event that selects a category', () => {
    const answered = play(
      { type: 'request', fingerprint: 'A' },
      { type: 'finished', run: 1, fingerprint: 'A', result: suggested() },
    );
    // The reducer's state has nowhere to hold a form value.
    expect(Object.keys(answered).sort()).toEqual([
      'attempts',
      'categoryDismissed',
      'merchantDismissed',
      'phase',
      'run',
    ]);
  });
});

describe('what Review Receipt shows beside Category', () => {
  const ready = play(
    { type: 'request', fingerprint: 'A' },
    { type: 'finished', run: 1, fingerprint: 'A', result: suggested() },
  );

  it('suggests Food without selecting it, in words a screen reader can say', () => {
    const view = describeCategorySuggestion(ready, {
      categories: CATEGORIES,
      selectedCategoryId: null,
    });
    expect(view).toEqual({
      kind: 'suggestion',
      categoryId: 11,
      categoryName: 'Food',
      prominent: true,
      title: 'Suggested category',
      confidenceLabel: 'High confidence',
      reason: 'Merchant appears to be a café.',
      actionLabel: 'Use Food',
      actionAccessibilityLabel: 'Use Food category',
      accessibilityLabel: 'Suggested category, Food, confidence high.',
    });
  });

  it('steps aside once a category is chosen — by accepting, or by hand', () => {
    expect(
      describeCategorySuggestion(ready, { categories: CATEGORIES, selectedCategoryId: 11 }),
    ).toEqual({ kind: 'hidden' });
    expect(
      describeCategorySuggestion(ready, { categories: CATEGORIES, selectedCategoryId: 12 }),
    ).toEqual({ kind: 'hidden' });
  });

  it('never makes a low-confidence answer look certain', () => {
    const low = play(
      { type: 'request', fingerprint: 'A' },
      { type: 'finished', run: 1, fingerprint: 'A', result: suggested({ confidence: 'low' }) },
    );
    const view = describeCategorySuggestion(low, {
      categories: CATEGORIES,
      selectedCategoryId: null,
    });
    expect(view).toMatchObject({
      kind: 'suggestion',
      prominent: false,
      title: 'Possible category',
      confidenceLabel: 'Low confidence',
    });
  });

  it('withdraws a suggestion whose category has since gone', () => {
    const shoppingOnly = CATEGORIES.filter((category) => category.id !== 11);
    expect(
      describeCategorySuggestion(ready, { categories: shoppingOnly, selectedCategoryId: null }),
    ).toEqual({ kind: 'hidden' });
  });

  it('says it is looking while the form stays usable', () => {
    const loading = play({ type: 'request', fingerprint: 'A' });
    expect(
      describeCategorySuggestion(loading, { categories: CATEGORIES, selectedCategoryId: null }),
    ).toEqual({ kind: 'loading', message: 'Finding a category suggestion…' });
  });

  it('says plainly when there is nothing to suggest', () => {
    const none = play(
      { type: 'request', fingerprint: 'A' },
      {
        type: 'finished',
        run: 1,
        fingerprint: 'A',
        result: { status: 'no_suggestion', meta: META },
      },
    );
    expect(
      describeCategorySuggestion(none, { categories: CATEGORIES, selectedCategoryId: null }),
    ).toEqual({ kind: 'message', message: SUGGESTION_COPY.noSuggestion, canRetry: false });
  });

  it.each([
    ['timeout', 'Couldn’t get a suggestion. Choose a category manually.', true],
    ['network', 'Couldn’t get a suggestion. Choose a category manually.', true],
    ['invalid_response', 'Couldn’t get a suggestion. Choose a category manually.', true],
    [
      'rate_limited',
      'Category suggestion isn’t available right now. Choose a category manually.',
      false,
    ],
    ['unauthenticated', 'AI category suggestions are available when signed in.', false],
  ] as const)('explains a %s failure without blocking anything', (reason, message, canRetry) => {
    const failed = play(
      { type: 'request', fingerprint: 'A' },
      { type: 'finished', run: 1, fingerprint: 'A', result: { status: 'failed', reason } },
    );
    expect(
      describeCategorySuggestion(failed, { categories: CATEGORIES, selectedCategoryId: null }),
    ).toEqual({ kind: 'message', message, canRetry });
  });
});

describe('what Review Receipt shows beside Merchant / Note', () => {
  const ready = play(
    { type: 'request', fingerprint: 'A' },
    {
      type: 'finished',
      run: 1,
      fingerprint: 'A',
      result: suggested({ normalizedMerchant: 'Starbucks' }),
    },
  );

  it('shows the detected text beside the suggestion', () => {
    expect(
      describeMerchantSuggestion(ready, {
        detectedMerchant: 'STARBUCKS #02319 KTM',
        fieldIsReceiptReading: true,
      }),
    ).toEqual({
      kind: 'suggestion',
      detected: 'STARBUCKS #02319 KTM',
      suggested: 'Starbucks',
      accessibilityLabel: 'Detected merchant, STARBUCKS #02319 KTM. Suggested merchant, Starbucks.',
    });
  });

  it('never offers to replace text the person typed, or kept', () => {
    expect(
      describeMerchantSuggestion(ready, {
        detectedMerchant: 'STARBUCKS #02319 KTM',
        fieldIsReceiptReading: false,
      }),
    ).toEqual({ kind: 'hidden' });
    expect(
      describeMerchantSuggestion(suggestionReducer(ready, { type: 'dismiss_merchant' }), {
        detectedMerchant: 'STARBUCKS #02319 KTM',
        fieldIsReceiptReading: true,
      }),
    ).toEqual({ kind: 'hidden' });
  });
});

describe('whether suggestions are offered at all', () => {
  it.each([
    [false, 'enabled', 'signed_in', 'hidden'],
    [true, 'disabled', 'signed_in', 'hidden'],
    [true, 'enabled', 'unconfigured', 'hidden'],
    [true, 'enabled', 'initializing', 'hidden'],
    [true, 'unset', 'signed_out', 'hidden'],
    [true, 'enabled', 'signed_out', 'sign_in_required'],
    [true, 'enabled', 'error', 'sign_in_required'],
    [true, 'unset', 'signed_in', 'needs_consent'],
    [true, 'enabled', 'signed_in', 'available'],
  ] as const)(
    'configured %s, preference %s, auth %s → %s',
    (configured, preference, authStatus, expected) => {
      expect(suggestionAvailability({ configured, preference, authStatus })).toBe(expected);
    },
  );

  it('reads an unknown stored preference as never asked, not as agreed', () => {
    expect(parseAiSuggestionPreference('enabled')).toBe('enabled');
    expect(parseAiSuggestionPreference('disabled')).toBe('disabled');
    expect(parseAiSuggestionPreference('yes')).toBe('unset');
    expect(parseAiSuggestionPreference(null)).toBe('unset');
  });
});
