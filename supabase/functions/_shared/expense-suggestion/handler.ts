import { bearerToken, type QuotaDecision } from './auth.ts';
import {
  ERROR_STATUS,
  SUGGESTION_LIMITS,
  type SuggestionErrorCode,
  type SuggestionOutput,
  type SuggestionRequest,
  type SuggestionResponseBody,
} from './contract.ts';
import { validateProviderOutput } from './output-validation.ts';
import type { ExpenseSuggestionProvider, ProviderOutcome, ProviderUsage } from './provider.ts';
import { validateSuggestionRequest } from './request-validation.ts';

/**
 * One suggestion request, from HTTP in to HTTP out.
 *
 * The order is the design. Each step is cheaper than the next and refuses
 * before anything more expensive runs:
 *
 * 1. method, bearer token and declared size — no I/O
 * 2. the token verified — before a byte of the body is read
 * 3. the body, read to a hard byte limit, and validated strictly
 * 4. the provider configured at all
 * 5. the caller's quota consumed — counted in Postgres, as the caller
 * 6. the provider, under a deadline
 * 7. the provider's output validated against this request's category set
 *
 * Nothing here can create, change or read a financial record. The provider
 * sees the validated request and an abort signal, and nothing else.
 *
 * Logging is one metadata event per request. `SuggestionLogEvent` has no field
 * that could hold a merchant name, a category name, a prompt or a model answer,
 * so a request body cannot end up in the function's logs by accident.
 */

export type SuggestionLogEvent = {
  requestId: string;
  provider: string | null;
  model: string | null;
  httpStatus: number;
  outcome: 'suggested' | 'no_suggestion' | SuggestionErrorCode;
  latencyMs: number;
  providerLatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type SuggestionHandlerDependencies = {
  /** Null when the deployment has no provider configured. */
  provider: ExpenseSuggestionProvider | null;
  verifyUser(token: string): Promise<{ userId: string } | null>;
  consumeQuota(token: string): Promise<QuotaDecision>;
  log(event: SuggestionLogEvent): void;
  deadlineMs: number;
  now?: () => number;
  createRequestId?: () => string;
};

const NO_SUGGESTION: SuggestionOutput = {
  categoryId: null,
  merchantName: null,
  confidence: 'low',
  reason: null,
};

export async function handleSuggestionRequest(
  request: Request,
  deps: SuggestionHandlerDependencies,
): Promise<Response> {
  const now = deps.now ?? Date.now;
  const started = now();
  const requestId = (deps.createRequestId ?? (() => crypto.randomUUID()))();
  const provider = deps.provider;
  let providerLatencyMs: number | null = null;
  let usage: ProviderUsage | null = null;

  const finish = (
    httpStatus: number,
    outcome: SuggestionLogEvent['outcome'],
    body: SuggestionResponseBody,
  ): Response => {
    try {
      deps.log({
        requestId,
        provider: provider?.id ?? null,
        model: provider?.model ?? null,
        httpStatus,
        outcome,
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
  const fail = (code: SuggestionErrorCode) =>
    finish(ERROR_STATUS[code], code, { status: 'error', code, requestId });
  const succeed = (output: SuggestionOutput, activeProvider: ExpenseSuggestionProvider) =>
    finish(
      200,
      output.categoryId === null && output.merchantName === null ? 'no_suggestion' : 'suggested',
      {
        status: 'ok',
        suggestion: output,
        requestId,
        provider: activeProvider.id,
        model: activeProvider.model,
      },
    );

  try {
    if (request.method !== 'POST') return fail('method_not_allowed');

    const token = bearerToken(request.headers.get('authorization'));
    if (token === null) return fail('unauthenticated');

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > SUGGESTION_LIMITS.maxBodyBytes) {
      return fail('payload_too_large');
    }

    const caller = await deps.verifyUser(token).catch(() => null);
    if (caller === null) return fail('unauthenticated');

    const text = await readBoundedText(request, SUGGESTION_LIMITS.maxBodyBytes);
    if (text === null) return fail('payload_too_large');

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return fail('invalid_request');
    }
    const validation = validateSuggestionRequest(body);
    if (!validation.ok) return fail('invalid_request');

    // Checked before the quota, so a deployment without a provider never
    // spends anyone's allowance on requests it cannot serve.
    if (provider === null) return fail('not_configured');

    const quota = await deps.consumeQuota(token).catch((): QuotaDecision => 'unavailable');
    if (quota === 'limited') return fail('rate_limited');
    if (quota !== 'allowed') return fail('suggestion_unavailable');

    const providerStarted = now();
    const outcome = await withDeadline(provider, validation.request, deps.deadlineMs);
    providerLatencyMs = now() - providerStarted;
    usage = outcome.usage;

    if (outcome.kind === 'failure') {
      switch (outcome.failure) {
        case 'refused':
          // A declined classification is a safe answer: no suggestion.
          return succeed(NO_SUGGESTION, provider);
        case 'timeout':
          return fail('timeout');
        case 'truncated':
          return fail('invalid_provider_response');
        case 'misconfigured':
          return fail('not_configured');
        case 'rate_limited':
        case 'unavailable':
          return fail('suggestion_unavailable');
      }
    }

    const checked = validateProviderOutput(outcome.value, validation.request);
    if (!checked.ok) return fail('invalid_provider_response');
    return succeed(checked.output, provider);
  } catch {
    return fail('suggestion_unavailable');
  }
}

async function withDeadline(
  provider: ExpenseSuggestionProvider,
  request: SuggestionRequest,
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
        .suggest(request, controller.signal)
        .catch((): ProviderOutcome => ({ kind: 'failure', failure: 'unavailable', usage: null })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The body as text, or null once it passes `max` bytes — whatever Content-Length claimed. */
export async function readBoundedText(request: Request, max: number): Promise<string | null> {
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
