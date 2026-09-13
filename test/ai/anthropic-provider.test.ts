import { describe, expect, it } from 'vitest';

import {
  createAnthropicSuggestionProvider,
  normalizeAnthropicMessage,
  supportsDefaultFallbacks,
} from '../../supabase/functions/_shared/expense-suggestion/anthropic-provider.ts';
import type { SuggestionRequest } from '../../supabase/functions/_shared/expense-suggestion/contract.ts';
import {
  buildUserMessage,
  SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/expense-suggestion/prompt.ts';

/**
 * The Claude provider, exercised through the real SDK with a fake `fetch`.
 * Nothing reaches the network, and no key is real. What is checked is the
 * request the SDK would put on the wire, and how each kind of answer is
 * normalised before it leaves the provider.
 */

const REQUEST: SuggestionRequest = {
  version: 1,
  merchantText: 'ABC CAFE',
  categories: [
    { id: 'c1', name: 'Food' },
    { id: 'c2', name: 'Shopping' },
  ],
};

type Captured = { url: string; headers: Headers; body: Record<string, unknown> };

function message(text: string, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 210, output_tokens: 34 },
  };
}

function fakeFetch(responses: (() => Response)[]) {
  const captured: Captured[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const next = responses[Math.min(captured.length - 1, responses.length - 1)]!;
    return next();
  };
  return { fetch: fetch as typeof globalThis.fetch, captured };
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'retry-after-ms': '0' },
  });

function providerWith(responses: (() => Response)[], model = 'claude-opus-5') {
  const { fetch, captured } = fakeFetch(responses);
  const provider = createAnthropicSuggestionProvider({
    apiKey: 'test-key-not-real',
    model,
    attemptTimeoutMs: 2_000,
    fetch,
  });
  return { provider, captured };
}

const answer = JSON.stringify({
  categoryId: 'c1',
  merchantName: 'ABC Café',
  confidence: 'high',
  reason: null,
});

describe('the request Claude receives', () => {
  it('is one structured-output message: no tools, no images, low effort, default fallbacks', async () => {
    const { provider, captured } = providerWith([json(200, message(answer))]);

    const outcome = await provider.suggest(REQUEST, new AbortController().signal);

    expect(outcome).toEqual({
      kind: 'output',
      value: { categoryId: 'c1', merchantName: 'ABC Café', confidence: 'high', reason: null },
      usage: { inputTokens: 210, outputTokens: 34 },
    });
    expect(captured).toHaveLength(1);
    const { body, headers, url } = captured[0]!;

    expect(url).toContain('/v1/messages');
    expect(body.model).toBe('claude-opus-5');
    expect(body.max_tokens).toBe(1_024);
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.messages).toEqual([{ role: 'user', content: buildUserMessage(REQUEST) }]);
    expect(body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(body.fallbacks).toBe('default');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');

    // Classification only: nothing the model could use to act or to see more.
    for (const key of ['tools', 'tool_choice', 'mcp_servers', 'container', 'thinking']) {
      expect(body).not.toHaveProperty(key);
    }
    expect(JSON.stringify(body)).not.toMatch(/"type":"(image|document)"|base64/);
  });

  it('asks for no server-side fallback on a model that does not offer one', async () => {
    const { provider, captured } = providerWith([json(200, message(answer))], 'claude-haiku-4-5');
    await provider.suggest(REQUEST, new AbortController().signal);
    expect(captured[0]!.body).not.toHaveProperty('fallbacks');
    expect(supportsDefaultFallbacks('claude-haiku-4-5')).toBe(false);
    expect(supportsDefaultFallbacks('claude-opus-5')).toBe(true);
  });
});

describe('failures, normalised', () => {
  it('retries a rate limit once, then reports it', async () => {
    const limited = json(429, {
      type: 'error',
      error: { type: 'rate_limit_error', message: 'slow down' },
    });
    const { provider, captured } = providerWith([limited, limited, limited]);

    const outcome = await provider.suggest(REQUEST, new AbortController().signal);

    expect(outcome).toEqual({ kind: 'failure', failure: 'rate_limited', usage: null });
    expect(captured).toHaveLength(2);
  });

  it('retries a server error once, and recovers if the retry succeeds', async () => {
    const broken = json(500, { type: 'error', error: { type: 'api_error', message: 'oops' } });
    const { provider, captured } = providerWith([broken, json(200, message(answer))]);
    expect((await provider.suggest(REQUEST, new AbortController().signal)).kind).toBe('output');
    expect(captured).toHaveLength(2);
  });

  it('does not retry a bad key, and calls it a deployment problem', async () => {
    const denied = json(401, {
      type: 'error',
      error: { type: 'authentication_error', message: 'bad key' },
    });
    const { provider, captured } = providerWith([denied]);
    expect(await provider.suggest(REQUEST, new AbortController().signal)).toEqual({
      kind: 'failure',
      failure: 'misconfigured',
      usage: null,
    });
    expect(captured).toHaveLength(1);
  });

  it('reports an aborted request as a timeout', async () => {
    const controller = new AbortController();
    const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      })) as typeof globalThis.fetch;
    const provider = createAnthropicSuggestionProvider({
      apiKey: 'test-key-not-real',
      model: 'claude-opus-5',
      attemptTimeoutMs: 5_000,
      fetch: hanging,
    });

    const pending = provider.suggest(REQUEST, controller.signal);
    controller.abort();
    expect((await pending).kind === 'failure' && (await pending)).toMatchObject({
      failure: 'timeout',
    });
  });

  it.each([
    ['refusal', answer, { kind: 'failure', failure: 'refused' }],
    ['max_tokens', '{"categoryId":"c1","merch', { kind: 'failure', failure: 'truncated' }],
    ['tool_use', answer, { kind: 'output', value: null }],
    ['end_turn', 'I think it is Food', { kind: 'output', value: 'I think it is Food' }],
  ])('turns a %s stop into a provider-neutral outcome', (stopReason, text, expected) => {
    expect(normalizeAnthropicMessage(message(text, stopReason))).toMatchObject(expected);
  });
});
