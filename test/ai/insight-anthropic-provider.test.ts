import { describe, expect, it } from 'vitest';

import { createAnthropicInsightProvider } from '../../supabase/functions/_shared/financial-insight/anthropic-insight-provider.ts';
import type { InsightRequest } from '../../supabase/functions/_shared/financial-insight/contract.ts';
import {
  buildInsightUserMessage,
  INSIGHT_OUTPUT_SCHEMA,
  INSIGHT_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/financial-insight/prompt.ts';

/**
 * The Claude insight provider through the real SDK, with a fake `fetch`.
 * Nothing reaches the network and no key is real.
 */

const REQUEST: InsightRequest = {
  version: 1,
  intent: 'summary',
  question: 'How much did I spend?',
  context: {
    contextVersion: 1,
    snapshotDate: '2026-09-13',
    period: {
      kind: 'this_month',
      label: 'September 2026 (this month)',
      start: '2026-09-01',
      end: '2026-09-30',
    },
    notes: [],
    summary: [
      {
        currency: 'NPR',
        income: { minor: 0, display: 'NPR 0.00' },
        expense: { minor: 4_250_000, display: 'NPR 42,500.00' },
        savings: { minor: -4_250_000, display: '-NPR 42,500.00' },
      },
    ],
  },
};

const ANSWER = JSON.stringify({
  answer: 'For September 2026 (this month), you spent NPR 42,500.00.',
  keyPoints: [],
  caveats: [],
});

function message(text: string, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 640, output_tokens: 55 },
  };
}

const json = (status: number, value: unknown) => () =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'retry-after-ms': '0' },
  });

function providerWith(responses: (() => Response)[]) {
  const captured: { headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return responses[Math.min(captured.length - 1, responses.length - 1)]!();
  }) as typeof globalThis.fetch;
  const provider = createAnthropicInsightProvider({
    apiKey: 'test-key-not-real',
    model: 'claude-opus-5',
    attemptTimeoutMs: 2_000,
    fetch,
  });
  return { provider, captured };
}

describe('the request Claude receives', () => {
  it('is one structured explanation request: no tools, no sampling knobs, low effort', async () => {
    const { provider, captured } = providerWith([json(200, message(ANSWER))]);

    const outcome = await provider.explain(REQUEST, new AbortController().signal);

    expect(outcome).toEqual({
      kind: 'output',
      value: JSON.parse(ANSWER),
      usage: { inputTokens: 640, outputTokens: 55 },
    });
    const { body, headers } = captured[0]!;
    expect(body).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 2_048,
      system: INSIGHT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildInsightUserMessage(REQUEST) }],
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: INSIGHT_OUTPUT_SCHEMA },
      },
      fallbacks: 'default',
    });
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    for (const key of [
      'tools',
      'tool_choice',
      'mcp_servers',
      'container',
      'thinking',
      'temperature',
      'top_p',
      'top_k',
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(JSON.stringify(body)).not.toMatch(/"type":"(image|document)"|base64/);
  });
});

describe('failures, normalised', () => {
  it('retries a rate limit once, then reports it', async () => {
    const limited = json(429, {
      type: 'error',
      error: { type: 'rate_limit_error', message: 'slow down' },
    });
    const { provider, captured } = providerWith([limited, limited, limited]);
    expect(await provider.explain(REQUEST, new AbortController().signal)).toEqual({
      kind: 'failure',
      failure: 'rate_limited',
      usage: null,
    });
    expect(captured).toHaveLength(2);
  });

  it('reports a declined request as refused, and a cut-off answer as truncated', async () => {
    const refused = providerWith([json(200, message(ANSWER, 'refusal'))]);
    const truncated = providerWith([json(200, message('{"answer":"For Sept', 'max_tokens'))]);
    expect(await refused.provider.explain(REQUEST, new AbortController().signal)).toMatchObject({
      kind: 'failure',
      failure: 'refused',
    });
    expect(await truncated.provider.explain(REQUEST, new AbortController().signal)).toMatchObject({
      kind: 'failure',
      failure: 'truncated',
    });
  });
});
