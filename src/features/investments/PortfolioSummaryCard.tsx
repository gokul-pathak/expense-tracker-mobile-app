import { View } from 'react-native';

import { Card, Money, Text } from '@/components/ui';
import { useTheme } from '@/theme';

import { FigureRow } from './FigureRow';
import { GainLine } from './GainLine';
import {
  describeValueAvailability,
  portfolioAccessibilityLabel,
  portfolioTitle,
  speakAmount,
} from './investment-presentation';
import type { CurrencyPortfolioSummary } from './investment.types';

type Props = {
  summary: CurrencyPortfolioSummary;
  /** The only currency on screen, so its value is the screen's one large figure. */
  prominent: boolean;
};

/**
 * One currency's portfolio — never a total across currencies, which would need a
 * conversion rate the app does not have.
 *
 * The value is shown only when every open holding is priced. Otherwise the card
 * says the value is unavailable and how much of it is known, and cost basis is
 * still shown in full, because it does not depend on a price.
 */
export function PortfolioSummaryCard({ summary, prominent }: Props) {
  const { space } = useTheme();
  const { currency } = summary;
  const availability = describeValueAvailability(summary);

  return (
    <Card hero={prominent}>
      <View accessible accessibilityLabel={portfolioAccessibilityLabel(summary)}>
        <Text variant="eyebrow" tone="tertiary">
          {portfolioTitle(currency)}
        </Text>
        {summary.marketValueMinor !== null ? (
          <Money
            minorUnits={summary.marketValueMinor}
            currency={currency}
            size={prominent ? 'hero' : 'stat'}
            style={{ marginTop: space.sm }}
          />
        ) : (
          <Text variant="heading" tone="secondary" style={{ marginTop: space.sm }}>
            Current value unavailable
          </Text>
        )}
        {availability ? (
          <Text variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
            {availability}
          </Text>
        ) : null}
      </View>

      <View style={{ marginTop: space.md }}>
        <FigureRow
          label="Cost basis"
          divided
          accessibilityLabel={'Cost basis, ' + speakAmount(summary.costBasisMinor, currency)}
        >
          <Money minorUnits={summary.costBasisMinor} currency={currency} size="row" align="right" />
        </FigureRow>
        <FigureRow label="Unrealized gain/loss">
          {summary.unrealizedGainMinor === null ? (
            <Text variant="caption" tone="tertiary" align="right">
              Unavailable
            </Text>
          ) : (
            <GainLine
              minorUnits={summary.unrealizedGainMinor}
              currency={currency}
              kind="unrealized"
              align="right"
              size="body"
            />
          )}
        </FigureRow>
        <FigureRow label="Realized gain/loss">
          <GainLine
            minorUnits={summary.realizedGainMinor}
            currency={currency}
            kind="realized"
            align="right"
            size="body"
          />
        </FigureRow>
        {summary.dividendsMinor > 0 ? (
          <FigureRow
            label="Dividends"
            accessibilityLabel={'Dividends, ' + speakAmount(summary.dividendsMinor, currency)}
          >
            <Money
              minorUnits={summary.dividendsMinor}
              currency={currency}
              size="row"
              align="right"
            />
          </FigureRow>
        ) : null}
      </View>
    </Card>
  );
}
