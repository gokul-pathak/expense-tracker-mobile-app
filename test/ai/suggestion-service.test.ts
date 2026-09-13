import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

// The real client needs a configured project. Tests never have one.
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));

import {
  CLIENT_SUGGESTION_TIMEOUT_MS,
  prepareExpenseSuggestion,
  requestExpenseSuggestion,
} from '@/features/ai/expense-suggestion.service';
import type {
  AiExpenseSuggestionProvider,
  ExpenseSuggestionRequest,
  ProviderResponse,
} from '@/features/ai/expense-suggestion.types';
import {
  createSupabaseSuggestionProvider,
  EXPENSE_SUGGESTION_FUNCTION,
  failureForStatus,
  supabaseSuggestionProvider,
} from '@/features/ai/supabase-expense-suggestion.provider';
import { readSupabaseConfig } from '@/lib/supabase/config';

/**
 * Sending a prepared request, once, through a provider — and the app's one
 * real provider, the project's Edge Function, reduced to a fake client.
 */

function prepared() {
  const outcome = prepareExpenseSuggestion(
    { merchantCandidate: 'ABC CAFE' },
    [{ id: 11, name: 'Food', systemKey: 'expense_food' }],
    'receipt:1',
  );
  if (outcome.kind !== 'ready') throw new Error('expected a request');
  return outcome.prepared;
}

const OK_BODY = {
  status: 'ok',
  suggestion: { categoryId: 'c1', merchantName: null, confidence: 'high', reason: null },
  requestId: 'req-1',
  provider: 'anthropic',
  model: 'claude-opus-5',
};

function provider(
  respond: (request: ExpenseSuggestionRequest) => Promise<ProviderResponse>,
  available = true,
) {
  const calls: { request: ExpenseSuggestionRequest; timeoutMs: number }[] = [];
  const fake: AiExpenseSuggestionProvider = {
    id: 'fake',
    isAvailable: () => available,
    suggest: (request, options) => {
      calls.push({ request, timeoutMs: options.timeoutMs });
      return respond(request);
    },
  };
  return { fake, calls };
}

describe('requesting a suggestion', () => {
  it('sends the prepared request exactly, with a bounded timeout', async () => {
    const { fake, calls } = provider(async () => ({ kind: 'response', body: OK_BODY }));
    const request = prepared();

    const result = await requestExpenseSuggestion(request, fake, {
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('suggested');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.request).toBe(request.request);
    expect(calls[0]?.timeoutMs).toBe(CLIENT_SUGGESTION_TIMEOUT_MS);
  });

  it('passes a classified failure through, and turns a thrown error into a network failure', async () => {
    const limited = provider(async () => ({ kind: 'failure', reason: 'rate_limited' }));
    const thrown = provider(async () => {
      throw new Error('socket hang up');
    });
    const signal = new AbortController().signal;

    expect(await requestExpenseSuggestion(prepared(), limited.fake, { signal })).toEqual({
      status: 'failed',
      reason: 'rate_limited',
    });
    expect(await requestExpenseSuggestion(prepared(), thrown.fake, { signal })).toEqual({
      status: 'failed',
      reason: 'network',
    });
  });

  it('sends nothing when no provider is configured', async () => {
    const { fake, calls } = provider(async () => ({ kind: 'response', body: OK_BODY }), false);
    const result = await requestExpenseSuggestion(prepared(), fake, {
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ status: 'failed', reason: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('ignores an answer that arrives after the form stopped waiting', async () => {
    const controller = new AbortController();
    let release!: () => void;
    const { fake } = provider(
      () =>
        new Promise<ProviderResponse>((resolve) => {
          release = () => resolve({ kind: 'response', body: OK_BODY });
        }),
    );

    const pending = requestExpenseSuggestion(prepared(), fake, { signal: controller.signal });
    controller.abort();
    release();

    expect(await pending).toEqual({ status: 'failed', reason: 'cancelled' });
  });
});

describe('the Edge Function provider', () => {
  function client(result: { data: unknown; error: unknown }) {
    const invocations: { name: string; options: Record<string, unknown> }[] = [];
    const fake = {
      functions: {
        invoke: async (name: string, options: Record<string, unknown>) => {
          invocations.push({ name, options });
          return result;
        },
      },
    };
    return { get: () => fake as never, invocations };
  }

  it('invokes the one function, sending the request as its whole body', async () => {
    const { get, invocations } = client({ data: OK_BODY, error: null });
    const edge = createSupabaseSuggestionProvider(get);
    const request = prepared().request;
    const signal = new AbortController().signal;

    expect(await edge.suggest(request, { signal, timeoutMs: 12_000 })).toEqual({
      kind: 'response',
      body: OK_BODY,
    });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.name).toBe(EXPENSE_SUGGESTION_FUNCTION);
    // No user id, no headers of its own: the client attaches the session token.
    expect(Object.keys(invocations[0]!.options).sort()).toEqual(['body', 'signal', 'timeout']);
    expect(invocations[0]?.options.body).toBe(request);
  });

  it.each([
    [new FunctionsHttpError(new Response(null, { status: 401 })), 'unauthenticated'],
    [new FunctionsHttpError(new Response(null, { status: 429 })), 'rate_limited'],
    [new FunctionsHttpError(new Response(null, { status: 502 })), 'invalid_response'],
    [new FunctionsHttpError(new Response(null, { status: 503 })), 'unavailable'],
    [new FunctionsHttpError(new Response(null, { status: 504 })), 'timeout'],
    [new FunctionsFetchError({ name: 'AbortError' }), 'timeout'],
    [new FunctionsFetchError(new TypeError('Network request failed')), 'network'],
    [new FunctionsRelayError(new Response(null, { status: 500 })), 'unavailable'],
  ])('classifies %s without reading its body', async (error, reason) => {
    const { get } = client({ data: null, error });
    const edge = createSupabaseSuggestionProvider(get);
    const result = await edge.suggest(prepared().request, {
      signal: new AbortController().signal,
      timeoutMs: 12_000,
    });
    expect(result).toEqual({ kind: 'failure', reason });
  });

  it('maps statuses conservatively', () => {
    expect(failureForStatus(400)).toBe('unavailable');
    expect(failureForStatus(413)).toBe('unavailable');
    expect(failureForStatus(403)).toBe('unauthenticated');
  });

  it('is unavailable, and sends nothing, in a build or test with no project', async () => {
    expect(readSupabaseConfig({})).toBeNull();
    expect(supabaseSuggestionProvider.isAvailable()).toBe(false);
    expect(
      await supabaseSuggestionProvider.suggest(prepared().request, {
        signal: new AbortController().signal,
        timeoutMs: 1,
      }),
    ).toEqual({ kind: 'failure', reason: 'not_configured' });
  });
});
