import { isPlainObject } from './request-validation.ts';

/**
 * The deployment's configuration, read from its environment.
 *
 * Every secret lives here and only here: `ANTHROPIC_API_KEY` is a Supabase
 * Edge Function secret (`supabase secrets set`), per project. A development or
 * staging project has its own key and its own model setting, and the app
 * reaches whichever project its build is pointed at — so an automated test,
 * which has no project configured at all, reaches none.
 *
 * Missing configuration disables suggestions rather than failing loudly. The
 * app treats that exactly like any other unavailable suggestion: the person
 * chooses a category themselves.
 */

/**
 * The default model. Overridable per deployment with `AI_SUGGESTION_MODEL`,
 * for example to trade accuracy for cost, without shipping the app.
 */
export const DEFAULT_SUGGESTION_MODEL = 'claude-opus-5';

/** One provider attempt. */
export const PROVIDER_ATTEMPT_TIMEOUT_MS = 6_000;
/**
 * Everything the provider does for one request, retry included. Shorter than
 * the app's own timeout, so the server answers before the phone gives up.
 */
export const SUGGESTION_DEADLINE_MS = 9_000;

const MODEL_ID = /^claude-[a-z0-9.-]+$/;

/** One explanation attempt, and the whole explanation including a retry. */
export const INSIGHT_ATTEMPT_TIMEOUT_MS = 8_000;
export const INSIGHT_DEADLINE_MS = 12_000;

export type ServerConfig = {
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  provider: 'anthropic' | 'disabled';
  anthropicApiKey: string | null;
  model: string;
  /** Spending Insights explanations: switched and modelled separately from suggestions. */
  insightProvider: 'anthropic' | 'disabled';
  insightModel: string;
};

export function readServerConfig(get: (name: string) => string | undefined): ServerConfig {
  const anthropicApiKey = nonEmpty(get('ANTHROPIC_API_KEY'));
  const model = nonEmpty(get('AI_SUGGESTION_MODEL')) ?? DEFAULT_SUGGESTION_MODEL;
  // `AI_SUGGESTION_PROVIDER=disabled` is the kill switch.
  const requested = nonEmpty(get('AI_SUGGESTION_PROVIDER')) ?? 'anthropic';
  const provider =
    requested === 'anthropic' && anthropicApiKey !== null && MODEL_ID.test(model)
      ? 'anthropic'
      : 'disabled';

  const insightModel = nonEmpty(get('AI_INSIGHT_MODEL')) ?? DEFAULT_SUGGESTION_MODEL;
  const insightRequested = nonEmpty(get('AI_INSIGHT_PROVIDER')) ?? 'anthropic';
  const insightProvider =
    insightRequested === 'anthropic' && anthropicApiKey !== null && MODEL_ID.test(insightModel)
      ? 'anthropic'
      : 'disabled';

  return {
    supabaseUrl: nonEmpty(get('SUPABASE_URL')),
    supabasePublishableKey:
      publishableKeyFrom(get('SUPABASE_PUBLISHABLE_KEYS')) ?? nonEmpty(get('SUPABASE_ANON_KEY')),
    provider,
    anthropicApiKey:
      provider === 'anthropic' || insightProvider === 'anthropic' ? anthropicApiKey : null,
    model,
    insightProvider,
    insightModel,
  };
}

/**
 * `SUPABASE_PUBLISHABLE_KEYS` holds the project's named publishable keys as
 * JSON. Prefer the one named `default`; otherwise any one will do, since each
 * only identifies the project and grants nothing on its own.
 */
function publishableKeyFrom(raw: string | undefined): string | null {
  const value = nonEmpty(raw);
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isPlainObject(parsed)) return null;
    if (typeof parsed.default === 'string' && parsed.default !== '') return parsed.default;
    const first = Object.values(parsed).find(
      (key): key is string => typeof key === 'string' && key !== '',
    );
    return first ?? null;
  } catch {
    return value.startsWith('sb_publishable_') ? value : null;
  }
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
