/**
 * Whether this device may ask for AI suggestions.
 *
 * A device preference, like the theme and App Lock: stored on this device
 * only, never in the synced `settings` row, never in a backup. Agreeing on a
 * phone is not agreeing on a tablet, and a privacy choice should not arrive on
 * a second device without the person making it there.
 *
 * `unset` means never asked, which is not the same as agreed.
 */
export type AiSuggestionPreference = 'enabled' | 'disabled' | 'unset';

export const AI_SUGGESTION_PREFERENCE_KEY = 'ai.expense-suggestions.v1';

/**
 * Whether this device has shown the Spending Insights disclosure and had it
 * accepted. Not a second switch: the preference above still turns AI on and
 * off everywhere. Insights send different data from receipts — calculated
 * figures rather than a merchant name — so agreeing to one is not taken as
 * agreeing to the other.
 */
export const AI_INSIGHTS_DISCLOSURE_KEY = 'ai.insights-disclosure.v1';

export function parseAiSuggestionPreference(value: unknown): AiSuggestionPreference {
  return value === 'enabled' || value === 'disabled' ? value : 'unset';
}
