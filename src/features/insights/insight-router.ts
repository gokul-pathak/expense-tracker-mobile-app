import {
  SECTIONS_FOR_INTENT,
  type ContextPlan,
  type InsightIntent,
  type ResolvedPeriod,
} from './financial-context.types';
import {
  lastWeekPeriod,
  lastYearPeriod,
  monthIndexOf,
  monthPeriod,
  resolvePresetPeriod,
  todayPeriod,
  yesterdayPeriod,
} from './insight-period';

/**
 * Which kind of question this is, decided by plain phrase matching on the
 * device.
 *
 * Deterministic on purpose. A model never decides what to read: the question
 * picks one of a fixed set of intents, each intent names the context sections
 * it may use, and those sections are built by the domain services. A question
 * that asks to change something, or asks for a forecast or advice, is answered
 * here and never sent anywhere.
 */

export const INSIGHT_QUESTION_MAX = 300;

export const SUGGESTED_QUESTIONS = [
  'Where did my money go this month?',
  'What was my biggest expense?',
  'How does this month compare with last month?',
  'Am I over any budgets?',
  'How much do people owe me?',
  'What recurring expenses are due?',
] as const;

export type UnsupportedReason = 'empty' | 'forecast' | 'investment' | 'tax' | 'advice' | 'unknown';

export type InsightFocus = {
  people: 'none' | 'ranking' | 'mentioned';
  accounts: 'totals' | 'named';
};

export type RoutedQuestion =
  | {
      kind: 'insight';
      intent: InsightIntent;
      period: ResolvedPeriod;
      periodSource: 'question' | 'selected';
      periodNote: string | null;
      focus: InsightFocus;
      /** The normalised question, for noticing names on the device. */
      mentionText: string;
    }
  | { kind: 'mutation'; destination: 'expense' | 'income' | null }
  | { kind: 'unsupported'; reason: UnsupportedReason };

const MUTATION =
  /^(?:please |kindly |hey |ok |okay )?(?:can you |could you |would you |will you |i want to |i'd like to |i would like to |help me |go ahead and )?(?:add|create|record|log|enter|insert|delete|remove|erase|edit|change|update|modify|rename|transfer|move|send|pay|repay|lend|borrow|set|cancel|skip|generate|mark|undo|clear|reset|archive|restore)\b/;

const FORECAST =
  /\b(?:forecast|predict|prediction|projection|projected|next (?:week|month|year)|will i|am i going to|going to spend|in the future)\b/;
const INVESTMENT =
  /\b(?:stocks?|shares?|invest|investing|investments?|crypto|bitcoin|portfolio|mutual funds?|etfs?|bonds?|trading|trade)\b/;
const TAX = /\b(?:tax|taxes|taxable|deduct|deductible|deductions?)\b/;
const ADVICE =
  /\b(?:should i|advice|advise|recommend|recommendation|suggest (?:how|what|where)|loan|mortgage|credit score|interest rates?|cut back)\b/;

const INTENT_PATTERNS: readonly [InsightIntent, RegExp][] = [
  [
    'recurring',
    /\b(?:recurring|repeating|repeat|subscriptions?|scheduled|standing orders?|due|upcoming bills?)\b/,
  ],
  [
    'lending',
    /\b(?:owe|owes|owed|owing|lent|lend|lending|borrow|borrowed|borrowing|debts?|receivables?|liabilit(?:y|ies)|pay me back|paid me back|loaned)\b/,
  ],
  ['budgets', /\b(?:budgets?|budgeted|over (?:the |my )?limit|overspent|overspend)\b/],
  [
    'trend',
    /\b(?:compare|compared|comparison|vs|versus|than last|than the previous|than before|increased?|decreased?|went up|went down|go up|go down|higher|lower|more than|less than|trend|changed?|why did)\b/,
  ],
  [
    'spending_categories',
    /\b(?:categor(?:y|ies)|where did (?:most of )?(?:my|the|all my) money go|where (?:did|do|does) (?:i|my money) (?:spend|go)|spen[dt] (?:the )?most on|breakdown|what did i spend (?:it|money|the most) on)\b/,
  ],
  [
    'largest_expenses',
    /\b(?:biggest|largest|highest|most expensive|top) (?:expenses?|purchases?|transactions?|payments?|spends?|costs?|bills?)\b|\b(?:biggest|largest)\b/,
  ],
  [
    'accounts',
    /\b(?:balances?|accounts?|how much money do i have|money (?:do i have|left)|available|in the bank|cash on hand|net worth)\b/,
  ],
  [
    'summary',
    /\b(?:spend|spent|spending|expenses?|income|earn|earned|earnings|save|saved|saving|savings|made|total|how much)\b/,
  ],
];

const RANKING = /\b(?:who|whom|which (?:person|people|friends?)|each|everyone|most|least|list)\b/;
const NAMED_ACCOUNTS = /\b(?:which|each|per|by|every|list)\b.*\baccounts?\b|\baccounts\b/;
const VAGUE = /\b(?:recently|lately|these days|recent)\b/;

export function normalizeQuestion(question: string): string {
  return question
    .slice(0, INSIGHT_QUESTION_MAX)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'%\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function routeInsightQuestion(
  question: string,
  selected: ResolvedPeriod,
  now = new Date(),
): RoutedQuestion {
  const text = normalizeQuestion(question);
  if (text === '') return { kind: 'unsupported', reason: 'empty' };

  if (MUTATION.test(text)) return { kind: 'mutation', destination: destinationOf(text) };
  if (FORECAST.test(text)) return { kind: 'unsupported', reason: 'forecast' };
  if (INVESTMENT.test(text)) return { kind: 'unsupported', reason: 'investment' };
  if (TAX.test(text)) return { kind: 'unsupported', reason: 'tax' };
  if (ADVICE.test(text)) return { kind: 'unsupported', reason: 'advice' };

  const intent = INTENT_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];
  if (intent === undefined) return { kind: 'unsupported', reason: 'unknown' };

  const fromQuestion = periodInQuestion(text, now);
  let periodNote: string | null = null;
  if (fromQuestion === null && VAGUE.test(text)) {
    periodNote = `"Recently" is not a fixed period, so this uses ${selected.label}.`;
  }

  return {
    kind: 'insight',
    intent,
    period: fromQuestion ?? selected,
    periodSource: fromQuestion === null ? 'selected' : 'question',
    periodNote,
    focus: {
      people: intent === 'lending' ? (RANKING.test(text) ? 'ranking' : 'mentioned') : 'none',
      accounts: intent === 'accounts' && NAMED_ACCOUNTS.test(text) ? 'named' : 'totals',
    },
    mentionText: text,
  };
}

export function contextPlanFor(routed: Extract<RoutedQuestion, { kind: 'insight' }>): ContextPlan {
  return {
    sections: SECTIONS_FOR_INTENT[routed.intent],
    period: routed.period,
    periodNote: routed.periodNote,
    people: routed.focus.people,
    accounts: routed.focus.accounts,
    mentionText: routed.mentionText,
  };
}

/**
 * A period the question names outright. Checked in order, so "this month
 * compared with last month" is about this month. A named month is the most
 * recent one that has begun; a month in the future is not a period to report on.
 */
function periodInQuestion(text: string, now: Date): ResolvedPeriod | null {
  if (/\btoday\b/.test(text)) return todayPeriod(now);
  if (/\byesterday\b/.test(text)) return yesterdayPeriod(now);
  if (/\bthis week\b/.test(text)) return resolvePresetPeriod('this_week', now);
  if (/\b(?:last|previous|past) week\b/.test(text)) return lastWeekPeriod(now);
  if (/\b(?:this|current) month\b/.test(text)) return resolvePresetPeriod('this_month', now);
  if (/\b(?:last|previous|prior) month\b/.test(text)) return resolvePresetPeriod('last_month', now);
  if (/\b(?:last|past|previous) (?:3|three) months\b/.test(text)) {
    return resolvePresetPeriod('last_3_months', now);
  }
  if (/\b(?:last|past|previous) (?:6|six) months\b/.test(text)) {
    return resolvePresetPeriod('last_6_months', now);
  }
  if (/\b(?:this year|year to date|ytd)\b/.test(text)) return resolvePresetPeriod('this_year', now);
  if (/\b(?:last|previous) year\b/.test(text)) return lastYearPeriod(now);

  const named =
    /\b(?:(?:in|for|during|of|since) (may)|(january|february|march|april|june|july|august|september|october|november|december))\b(?: (\d{4}))?/.exec(
      text,
    );
  if (named !== null) {
    const index = monthIndexOf(named[1] ?? named[2] ?? '');
    if (index === null) return null;
    const currentIndex = now.getFullYear() * 12 + now.getMonth();
    const year =
      named[3] !== undefined
        ? Number(named[3])
        : index <= now.getMonth()
          ? now.getFullYear()
          : now.getFullYear() - 1;
    if (year * 12 + index > currentIndex) return null;
    return monthPeriod(year, index);
  }
  return null;
}

function destinationOf(text: string): 'expense' | 'income' | null {
  if (!/^(?:\S+ ){0,3}(?:add|create|record|log|enter|insert)\b/.test(text)) return null;
  if (/\b(?:income|salary|earning|earnings|received|got paid)\b/.test(text)) return 'income';
  if (/\b(?:expenses?|spent|spend|paid|bought|purchase|bill)\b|\d/.test(text)) return 'expense';
  return null;
}
