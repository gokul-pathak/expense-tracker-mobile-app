import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Chip,
  ErrorState,
  FormScreen,
  Icon,
  ListRow,
  Money,
  NativeDataNotice,
  Screen,
  SectionHeader,
  Text,
  TextField,
} from '@/components/ui';
import {
  failureMessage,
  INSIGHT_COPY,
  mutationReply,
  readExplanation,
  SESSION_LIMIT_MESSAGE,
  unavailableMessage,
  unsupportedMessage,
  type MutationReply,
} from '@/features/ai/insights/assistant.presentation';
import { prepareInsightRequest } from '@/features/ai/insights/assistant.service';
import { canRetryInsight } from '@/features/ai/insights/assistant.state';
import type { PreparedInsight } from '@/features/ai/insights/assistant.types';
import { useFinancialInsightAssistant } from '@/features/ai/insights/useFinancialInsightAssistant';
import type {
  BuiltFinancialContext,
  ResolvedPeriod,
} from '@/features/insights/financial-context.types';
import { INSIGHT_PRESETS, type SelectablePreset } from '@/features/insights/insight-period';
import {
  INSIGHT_QUESTION_MAX,
  SUGGESTED_QUESTIONS,
  type RoutedQuestion,
} from '@/features/insights/insight-router';
import type { LocalFinancialInsight } from '@/features/insights/local-insights';
import type { ReportPreset } from '@/features/reports/reports.types';
import { useRefreshOnSyncedData } from '@/features/sync/use-synced-data';
import {
  buildFinancialContext,
  buildLocalInsights,
  contextPlanFor,
  isLocalFinanceDataAvailable,
  resolveInsightPeriod,
  routeInsightQuestion,
} from '@/features/ui/data';
import { useTheme } from '@/theme';

/**
 * Spending Insights: the app's own numbers, and — only if the person chooses —
 * a plain-language explanation of them.
 *
 * Read-only from end to end. The cards and the "From your records" figures are
 * built on the device by the domain services and shown directly, so they are
 * right whether or not an explanation arrives. A question is routed on the
 * device; asking to add or delete something is answered here, never sent, and
 * at most offers the ordinary empty form. An explanation is requested only
 * when the person asks a question with AI turned on and the disclosure
 * accepted, and it is validated against the same figures before it is shown.
 */
export default function SpendingInsightsScreen() {
  const params = useLocalSearchParams<{ preset?: string; start?: string; end?: string }>();
  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  return <SpendingInsights initial={initialPeriod(params)} />;
}

type Answer =
  | { kind: 'mutation'; question: string; reply: MutationReply }
  | { kind: 'unsupported'; question: string; message: string }
  | { kind: 'local_failure'; question: string }
  | {
      kind: 'insight';
      question: string;
      routed: Extract<RoutedQuestion, { kind: 'insight' }>;
      built: BuiltFinancialContext;
      prepared: PreparedInsight | null;
    };

function SpendingInsights({ initial }: { initial: ResolvedPeriod }) {
  const { space } = useTheme();
  const assistant = useFinancialInsightAssistant();
  const [period, setPeriod] = useState(initial);
  const [insights, setInsights] = useState<LocalFinancialInsight[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const { refreshPreference, cancel, clear, ask } = assistant;

  const load = useCallback(() => {
    try {
      setInsights(buildLocalInsights(period));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
    refreshPreference();
  }, [period, refreshPreference]);
  useFocusEffect(load);
  useRefreshOnSyncedData(load);

  const choosePeriod = (next: SelectablePreset) => {
    cancel();
    clear();
    setAnswer(null);
    setPeriod(resolveInsightPeriod(next));
  };

  const submit = (text: string) => {
    const trimmed = text.trim();
    cancel();
    if (trimmed === '') {
      setAnswer({ kind: 'unsupported', question: '', message: unsupportedMessage('empty') });
      return;
    }
    const routed = routeInsightQuestion(trimmed, period, new Date());
    if (routed.kind === 'mutation') {
      setAnswer({ kind: 'mutation', question: trimmed, reply: mutationReply(routed.destination) });
      return;
    }
    if (routed.kind === 'unsupported') {
      setAnswer({
        kind: 'unsupported',
        question: trimmed,
        message: unsupportedMessage(routed.reason),
      });
      return;
    }
    let built: BuiltFinancialContext;
    try {
      built = buildFinancialContext(contextPlanFor(routed), new Date());
    } catch {
      setAnswer({ kind: 'local_failure', question: trimmed });
      return;
    }
    const outcome = prepareInsightRequest({
      question: trimmed,
      intent: routed.intent,
      context: built.context,
    });
    const prepared = outcome.kind === 'ready' ? outcome.prepared : null;
    setAnswer({ kind: 'insight', question: trimmed, routed, built, prepared });
    if (prepared !== null) ask(prepared);
  };

  const clearAnswer = () => {
    clear();
    setAnswer(null);
    setQuestion('');
  };

  const selectedPreset = INSIGHT_PRESETS.find((option) => option.value === period.kind)?.value;

  return (
    <FormScreen title={INSIGHT_COPY.title} backIcon="arrow-left">
      <Text variant="body" tone="secondary">
        Explanations of your recorded numbers. Nothing here changes your records.
      </Text>

      <View style={[styles.wrap, { gap: space.sm, marginTop: space.lg }]}>
        {INSIGHT_PRESETS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            selected={selectedPreset === option.value}
            onPress={() => choosePeriod(option.value)}
          />
        ))}
        {period.kind === 'custom' ? (
          <Chip label="Custom" selected onPress={() => undefined} />
        ) : null}
      </View>

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title={INSIGHT_COPY.numbersHeader} />
        <Text variant="small" tone="tertiary" style={{ marginBottom: space.sm }}>
          {period.label}
        </Text>
        {loadFailed ? (
          <ErrorState
            message="These numbers could not be built from your local data. Your data is safe."
            onRetry={load}
          />
        ) : (
          <InsightCards insights={insights} />
        )}
      </View>

      <View style={{ marginTop: space.xxl }}>
        <SectionHeader title={INSIGHT_COPY.askHeader} />
        <Card padding="none">
          {SUGGESTED_QUESTIONS.map((suggestion, index) => (
            <ListRow
              key={suggestion}
              label={suggestion}
              accessibilityLabel={`Ask: ${suggestion}`}
              onPress={() => {
                setQuestion(suggestion);
                submit(suggestion);
              }}
              last={index === SUGGESTED_QUESTIONS.length - 1}
            />
          ))}
        </Card>
        <View style={{ marginTop: space.lg, gap: space.md }}>
          <TextField
            label={INSIGHT_COPY.inputLabel}
            placeholder={INSIGHT_COPY.inputPlaceholder}
            value={question}
            maxLength={INSIGHT_QUESTION_MAX}
            returnKeyType="send"
            onChangeText={setQuestion}
            onSubmitEditing={() => submit(question)}
          />
          <Button
            label={INSIGHT_COPY.ask}
            disabled={question.trim() === '' || assistant.state.phase.status === 'loading'}
            onPress={() => submit(question)}
          />
        </View>
      </View>

      {answer !== null ? (
        <Card style={{ marginTop: space.xl, gap: space.md }}>
          {answer.question !== '' ? <Text variant="bodyStrong">{answer.question}</Text> : null}
          <AnswerBody answer={answer} assistant={assistant} />
          <Button label={INSIGHT_COPY.clear} variant="text" small onPress={clearAnswer} />
        </Card>
      ) : null}
    </FormScreen>
  );
}

function InsightCards({ insights }: { insights: LocalFinancialInsight[] | null }) {
  const { palette, space } = useTheme();
  if (insights === null) return null;
  if (insights.length === 0) {
    return (
      <Card>
        <Text variant="body" tone="secondary">
          No income, expenses, budgets, amounts owed or due recurring transactions for this period.
        </Text>
      </Card>
    );
  }
  return (
    <Card padding="none">
      {insights.map((insight, index) => (
        <View
          key={insight.id}
          style={[
            {
              padding: space.lg,
              gap: space.xs,
              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: palette.hairline,
            },
          ]}
        >
          <View style={[styles.row, { gap: space.sm }]}>
            {insight.tone === 'over_budget' ? (
              <Icon name="triangle-alert" size="inline" color={palette.warning} />
            ) : null}
            <Text variant="caption" tone="tertiary" style={styles.flex}>
              {insight.title}
              {insight.tone === 'over_budget' ? ' · Over budget' : ''}
            </Text>
          </View>
          {insight.value !== null ? (
            <Money minorUnits={insight.value.minor} currency={insight.value.currency} size="row" />
          ) : null}
          <Text variant="small" tone="secondary">
            {insight.description}
          </Text>
        </View>
      ))}
    </Card>
  );
}

function AnswerBody({
  answer,
  assistant,
}: {
  answer: Answer;
  assistant: ReturnType<typeof useFinancialInsightAssistant>;
}) {
  const { space } = useTheme();

  switch (answer.kind) {
    case 'mutation':
      return (
        <View style={{ gap: space.md }}>
          <Text variant="body">{answer.reply.message}</Text>
          {answer.reply.action !== null ? (
            <Button
              label={answer.reply.action.label}
              variant="secondary"
              small
              fullWidth={false}
              onPress={() => router.push(answer.reply.action!.route as never)}
            />
          ) : null}
        </View>
      );
    case 'unsupported':
      return <Text variant="body">{answer.message}</Text>;
    case 'local_failure':
      return (
        <Text variant="body" tone="secondary">
          The numbers for this question could not be built from your local data. Your data is safe.
        </Text>
      );
    case 'insight':
      break;
  }

  const { built, routed, prepared } = answer;
  const { availability, declined, state } = assistant;
  const phase = state.phase;
  const mine =
    prepared !== null && 'fingerprint' in phase && phase.fingerprint === prepared.fingerprint;

  let aiPart: React.ReactNode = null;
  if (prepared === null) {
    aiPart = null;
  } else if (availability === 'needs_disclosure' && !declined) {
    aiPart = (
      <View style={{ gap: space.sm }}>
        <Text variant="bodyStrong">{INSIGHT_COPY.disclosureTitle}</Text>
        <Text variant="small" tone="secondary">
          {INSIGHT_COPY.disclosureBody}
        </Text>
        <Text variant="caption" tone="tertiary">
          {INSIGHT_COPY.disclosureFootnote}
        </Text>
        <View style={[styles.wrap, { gap: space.md }]}>
          <Button
            label={INSIGHT_COPY.disclosureAccept}
            variant="secondary"
            small
            fullWidth={false}
            onPress={() => assistant.acceptDisclosureAndAsk(prepared)}
          />
          <Button
            label={INSIGHT_COPY.disclosureDecline}
            variant="text"
            small
            onPress={assistant.declineDisclosure}
          />
        </View>
      </View>
    );
  } else if (declined) {
    aiPart = (
      <Text variant="caption" tone="tertiary">
        {INSIGHT_COPY.numbersOnly}
      </Text>
    );
  } else if (unavailableMessage(availability) !== null) {
    aiPart = (
      <Text variant="small" tone="secondary">
        {unavailableMessage(availability)}
      </Text>
    );
  } else if (mine && phase.status === 'loading') {
    aiPart = (
      <Text variant="small" tone="secondary" accessibilityLiveRegion="polite">
        {INSIGHT_COPY.loading}
      </Text>
    );
  } else if (mine && phase.status === 'explained') {
    const explanation = readExplanation(phase.explanation, built.personNames);
    aiPart = (
      <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
        <Text variant="eyebrow" tone="tertiary">
          {INSIGHT_COPY.aiLabel}
        </Text>
        <Text variant="body">{explanation.answer}</Text>
        {explanation.keyPoints.map((point) => (
          <View key={point} style={[styles.row, { gap: space.sm }]}>
            <Text variant="body" tone="tertiary" importantForAccessibility="no">
              •
            </Text>
            <Text variant="small" style={styles.flex}>
              {point}
            </Text>
          </View>
        ))}
        {explanation.caveats.map((caveat) => (
          <Text key={caveat} variant="caption" tone="secondary">
            {caveat}
          </Text>
        ))}
        <Text variant="caption" tone="tertiary">
          {INSIGHT_COPY.disclaimer}
        </Text>
      </View>
    );
  } else if (mine && phase.status === 'failed') {
    const message = failureMessage(phase.reason);
    aiPart = (
      <View style={{ gap: space.sm }}>
        {message !== null ? (
          <Text variant="small" tone="secondary" accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}
        {canRetryInsight(state) ? (
          <Button
            label={INSIGHT_COPY.retry}
            variant="text"
            icon="refresh-cw"
            small
            onPress={() => assistant.retry(prepared)}
          />
        ) : null}
      </View>
    );
  } else if (mine && phase.status === 'session_limit') {
    aiPart = (
      <Text variant="small" tone="secondary">
        {SESSION_LIMIT_MESSAGE}
      </Text>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      <Text variant="caption" tone="tertiary">
        Figures for {built.context.period.label}
        {routed.periodSource === 'question' ? ', from your question' : ''}.
      </Text>
      <View style={{ gap: space.sm }}>
        <Text variant="eyebrow" tone="tertiary">
          {INSIGHT_COPY.fromRecords}
        </Text>
        {built.headlines.length === 0 ? (
          <Text variant="small" tone="secondary">
            No recorded figures answer this for the period.
          </Text>
        ) : (
          built.headlines.map((headline) => (
            <View
              key={`${headline.label}-${headline.currency}`}
              style={[styles.row, styles.between, { gap: space.md }]}
            >
              <Text variant="small" tone="secondary" style={styles.flex}>
                {headline.label}
              </Text>
              <Money minorUnits={headline.minor} currency={headline.currency} size="row" />
            </View>
          ))
        )}
        {built.context.notes.map((note) => (
          <Text key={note} variant="caption" tone="tertiary">
            {note}
          </Text>
        ))}
      </View>
      {aiPart}
    </View>
  );
}

function initialPeriod(params: { preset?: string; start?: string; end?: string }): ResolvedPeriod {
  const now = new Date();
  const preset = params.preset as ReportPreset | undefined;
  try {
    if (preset === 'custom') {
      const start = Number(params.start);
      const end = Number(params.end);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        return resolveInsightPeriod('custom', now, { start: new Date(start), end: new Date(end) });
      }
    }
    if (preset !== undefined && INSIGHT_PRESETS.some((option) => option.value === preset)) {
      return resolveInsightPeriod(preset, now);
    }
  } catch {
    // An unreadable link opens on this month rather than failing.
  }
  return resolveInsightPeriod('this_month', now);
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  between: { justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
});
