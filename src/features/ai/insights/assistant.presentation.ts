import type { CloudAuthStatus } from '@/features/cloud-auth/auth.types';
import type { UnsupportedReason } from '@/features/insights/insight-router';
import type { CloudSyncStatus } from '@/features/sync/sync-status';

import type { AiSuggestionPreference } from '../ai-preference';

import type { InsightExplanation, InsightFailureReason } from './assistant.types';

/**
 * What Spending Insights says, decided without React.
 *
 * The figures are always the app's own. These rules only decide whether an AI
 * explanation may be asked for, and what to say when it cannot be — and every
 * one of those sentences ends with the numbers still shown.
 */

export type InsightAvailability =
  /** Auth is still restoring. Say nothing yet. */
  | 'checking'
  /** No cloud project in this build. Numbers only, without comment. */
  | 'not_configured'
  | 'disabled'
  | 'sign_in_required'
  /** Signed in as someone other than the account this device's data belongs to. */
  | 'account_mismatch'
  | 'needs_disclosure'
  | 'available';

export function insightAvailability(input: {
  configured: boolean;
  preference: AiSuggestionPreference;
  disclosureSeen: boolean;
  authStatus: CloudAuthStatus;
  syncStatus: CloudSyncStatus;
}): InsightAvailability {
  const { configured, preference, disclosureSeen, authStatus, syncStatus } = input;
  if (!configured || authStatus === 'unconfigured') return 'not_configured';
  if (preference === 'disabled') return 'disabled';
  if (authStatus === 'initializing') return 'checking';
  if (authStatus !== 'signed_in') return 'sign_in_required';
  // This device's figures belong to the linked account. Sending them under a
  // different signed-in account would attribute one person's money to another.
  if (
    syncStatus === 'account_mismatch' ||
    syncStatus === 'reconciliation_required' ||
    syncStatus === 'linking'
  ) {
    return 'account_mismatch';
  }
  if (preference !== 'enabled' || !disclosureSeen) return 'needs_disclosure';
  return 'available';
}

export const INSIGHT_COPY = {
  title: 'Spending Insights',
  numbersHeader: 'Your numbers',
  askHeader: 'Ask about your spending',
  inputLabel: 'Your question',
  inputPlaceholder: 'Ask about the numbers for this period',
  ask: 'Ask',
  loading: 'Analyzing your financial summary…',
  fromRecords: 'From your records',
  aiLabel: 'AI explanation',
  disclaimer:
    'AI explanations may be inaccurate. The totals shown come from your recorded transactions.',
  disclosureTitle: 'Explain with AI?',
  disclosureBody:
    'To explain an answer, your question and the figures the app calculated for it are sent to an AI service — for example totals, category amounts, budget progress or amounts owed for the chosen period. Short descriptions are sent only when you ask about your largest expenses. Your full transaction list, notes, contact details and account identifiers are not sent.',
  disclosureFootnote: 'You can turn AI off in Settings. Your numbers are always shown here.',
  disclosureAccept: 'Explain With AI',
  disclosureDecline: 'Numbers Only',
  numbersOnly: 'Showing numbers only for this visit.',
  disabled: 'AI explanations are off. You can turn them on in Settings.',
  signIn: 'AI explanations are available when signed in. Your numbers are shown above.',
  mismatch:
    'AI explanations are paused until Cloud Sync matches the signed-in account. Your numbers are shown above.',
  retry: 'Try Again',
  clear: 'Clear',
  supportedTopics:
    'You can ask about spending, categories, largest expenses, comparisons with an earlier period, budgets, balances, money owed, and recurring transactions that are due.',
} as const;

export function unavailableMessage(availability: InsightAvailability): string | null {
  switch (availability) {
    case 'disabled':
      return INSIGHT_COPY.disabled;
    case 'sign_in_required':
      return INSIGHT_COPY.signIn;
    case 'account_mismatch':
      return INSIGHT_COPY.mismatch;
    default:
      return null;
  }
}

export function failureMessage(reason: InsightFailureReason): string | null {
  switch (reason) {
    case 'network':
      return "AI explanation isn't available offline, but here are your current numbers.";
    case 'rate_limited':
      return "AI explanations aren't available right now. Your numbers above are still current.";
    case 'invalid_response':
      return "Couldn't get a reliable AI explanation, so none is shown. Your numbers above come from your records.";
    case 'unauthenticated':
      return INSIGHT_COPY.signIn;
    case 'not_configured':
    case 'cancelled':
      return null;
    case 'timeout':
    case 'unavailable':
      return "Couldn't get an AI explanation right now. Your numbers above come from your records.";
  }
}

export const SESSION_LIMIT_MESSAGE =
  "You've asked for many explanations in a row. Your numbers are still shown; try again later.";

export function unsupportedMessage(reason: UnsupportedReason): string {
  switch (reason) {
    case 'empty':
      return 'Type a question, or choose one of the suggestions.';
    case 'forecast':
      return "Forecasting isn't available yet. I can explain what has already been recorded.";
    case 'investment':
      return "I can explain the financial data recorded in the app, but I can't make purchases, give investment advice or change your records.";
    case 'tax':
      return "The app doesn't hold tax information, so I can't say how anything is treated for tax.";
    case 'advice':
      return "I can explain your recorded numbers, but I don't give financial, credit or loan advice.";
    case 'unknown':
      return `I can't answer that from your records. ${INSIGHT_COPY.supportedTopics}`;
  }
}

export type MutationReply = {
  message: string;
  action: { label: string; route: '/transaction/expense/new' | '/transaction/income/new' } | null;
};

/**
 * A request to change something. Answered on the device, never sent, and never
 * acted on: at most a button that opens the ordinary empty form.
 */
export function mutationReply(destination: 'expense' | 'income' | null): MutationReply {
  if (destination === 'expense') {
    return {
      message: "I can't modify your records from Spending Insights. Use Add Expense to record it.",
      action: { label: 'Open Add Expense', route: '/transaction/expense/new' },
    };
  }
  if (destination === 'income') {
    return {
      message: "I can't modify your records from Spending Insights. Use Add Income to record it.",
      action: { label: 'Open Add Income', route: '/transaction/income/new' },
    };
  }
  return {
    message:
      "I can't add, change or delete anything from Spending Insights. Your records are changed only from their own screens.",
    action: null,
  };
}

/**
 * An explanation, with `Person 1`… read back as the names they stand for.
 * The names never left the device; they are restored only for display.
 */
export function readExplanation(
  explanation: InsightExplanation,
  personNames: Readonly<Record<string, string>>,
): InsightExplanation {
  const aliases = Object.keys(personNames).sort((left, right) => right.length - left.length);
  const restore = (text: string) =>
    aliases.reduce(
      (current, alias) =>
        current.replace(new RegExp(`\\b${alias}\\b`, 'g'), personNames[alias] ?? alias),
      text,
    );
  return {
    answer: restore(explanation.answer),
    keyPoints: explanation.keyPoints.map(restore),
    caveats: explanation.caveats.map(restore),
  };
}
