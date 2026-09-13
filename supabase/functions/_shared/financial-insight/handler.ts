import { bearerToken, type QuotaDecision } from '../expense-suggestion/auth.ts';
import { readBoundedText } from '../expense-suggestion/handler.ts';
import type { ProviderOutcome, ProviderUsage } from '../expense-suggestion/provider.ts';

import {
  CONTEXT_SECTIONS,
  INSIGHT_ERROR_STATUS,
  INSIGHT_LIMITS,
  type InsightErrorCode,
  type InsightExplanation,
  type InsightIntent,
  type InsightRequest,
  type InsightResponseBody,
} from './contract.ts';
import { validateInsightRequest } from './context-validation.ts';
import { validateInsightOutput } from './output-validation.ts';
import type { FinancialInsightProvider } from './provider.ts';

/**
 * One explanation request, from HTTP in to HTTP out.
 *
 * The same order as the suggestion endpoint, cheapest refusal first: method,
 * token and declared size; the token verified; the body read to a hard limit
 * and validated strictly; the provider configured; the caller's own quota
 * consumed; the provider under a deadline; the answer validated and its numbers
 * checked against the context.
 *
 * The server keeps nothing: no context, no question, no answer, no cache. It
 * reads no financial database. Logging is one metadata event per request, and
 * `InsightLogEvent` has no field that could hold an amount, a name, a question
 * or an answer — only which sections were present, never what was in them.
 */

export type InsightLogEvent = {
  requestId: string;
  provider: string | null;
  model: string | null;
  httpStatus: number;
  outcome: 'explained' | InsightErrorCode;
  intent: InsightIntent | null;
  periodKind: string | null;
  sections: string[];
  requestBytes: number | null;
  latencyMs: number;
  providerLatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type InsightHandlerDependencies = {
  provider: FinancialInsightProvider | null;
  verifyUser(token: string): Promise<{ userId: string } | null>;
  consumeQuota(token: string): Promise<QuotaDecision>;
  log(event: InsightLogEvent): void;
  deadlineMs: number;
  now?: () => number;
  createRequestId?: () => string;
};

export async function handleInsightRequest(
  request: Request,
  deps: InsightHandlerDependencies,
): Promise<Response> {
  const now = deps.now ?? Date.now;
  const started = now();
  const requestId = (deps.createRequestId ?? (() => crypto.randomUUID()))();
  const provider = deps.provider;
  let validated: InsightRequest | null = null;
  let requestBytes: number | null = null;
  let providerLatencyMs: number | null = null;
  let usage: ProviderUsage | null = null;

  const finish = (
    httpStatus: number,
    outcome: InsightLogEvent['outcome'],
    body: InsightResponseBody,
  ): Response => {
    try {
      const period = validated?.context.period as { kind?: unknown } | undefined;
      deps.log({
        requestId,
        provider: provider?.id ?? null,
        model: provider?.model ?? null,
        httpStatus,
        outcome,
        intent: validated?.intent ?? null,
        periodKind: typeof period?.kind === 'string' ? period.kind : null,
        sections:
          validated === null
            ? []
            : CONTEXT_SECTIONS.filter((section) => section in (validated?.context ?? {})),
        requestBytes,
        latencyMs: now() - started,
        providerLatencyMs,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
      });
    } catch {
      // Diagnostics never decide the response.
    }
    return new Response(JSON.stringify(body), {
      status: httpStatus,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  };
  const fail = (code: InsightErrorCode) =>
    finish(INSIGHT_ERROR_STATUS[code], code, { status: 'error', code, requestId });
  const succeed = (explanation: InsightExplanation, active: FinancialInsightProvider) =>
    finish(200, 'explained', {
      status: 'ok',
      explanation,
      requestId,
      provider: active.id,
      model: active.model,
    });

  try {
    if (request.method !== 'POST') return fail('method_not_allowed');

    const token = bearerToken(request.headers.get('authorization'));
    if (token === null) return fail('unauthenticated');

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > INSIGHT_LIMITS.maxBodyBytes) {
      return fail('payload_too_large');
    }

    const caller = await deps.verifyUser(token).catch(() => null);
    if (caller === null) return fail('unauthenticated');

    const text = await readBoundedText(request, INSIGHT_LIMITS.maxBodyBytes);
    if (text === null) return fail('payload_too_large');
    requestBytes = text.length;

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return fail('invalid_request');
    }
    const validation = validateInsightRequest(body);
    if (!validation.ok) return fail('invalid_request');
    validated = validation.request;

    if (provider === null) return fail('not_configured');

    const quota = await deps.consumeQuota(token).catch((): QuotaDecision => 'unavailable');
    if (quota === 'limited') return fail('rate_limited');
    if (quota !== 'allowed') return fail('insight_unavailable');

    const providerStarted = now();
    const outcome = await explainWithDeadline(provider, validated, deps.deadlineMs);
    providerLatencyMs = now() - providerStarted;
    usage = outcome.usage;

    if (outcome.kind === 'failure') {
      switch (outcome.failure) {
        case 'timeout':
          return fail('timeout');
        case 'truncated':
          return fail('invalid_provider_response');
        case 'misconfigured':
          return fail('not_configured');
        case 'refused':
        case 'rate_limited':
        case 'unavailable':
          return fail('insight_unavailable');
      }
    }

    const checked = validateInsightOutput(outcome.value, validated);
    if (!checked.ok) return fail('invalid_provider_response');
    return succeed(checked.explanation, provider);
  } catch {
    return fail('insight_unavailable');
  }
}

async function explainWithDeadline(
  provider: FinancialInsightProvider,
  request: InsightRequest,
  deadlineMs: number,
): Promise<ProviderOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ProviderOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: 'failure', failure: 'timeout', usage: null });
    }, deadlineMs);
  });
  try {
    return await Promise.race([
      provider
        .explain(request, controller.signal)
        .catch((): ProviderOutcome => ({ kind: 'failure', failure: 'unavailable', usage: null })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
