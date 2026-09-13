import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import {
  AmountInput,
  Banner,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FormScreen,
  Icon,
  isIconName,
  NativeDataNotice,
  PickerSheet,
  Screen,
  SelectorField,
  Text,
  TextField,
  useToast,
  type PickerOption,
} from '@/components/ui';
import { DEFAULT_CURRENCY, PAYMENT_MODES, type PaymentMode } from '@/db/constants';
import type { Account } from '@/features/accounts/account.types';
import type { Category } from '@/features/categories/category.types';
import { ReceiptReading } from '@/features/receipts/scanner/ReceiptReading';
import {
  buildReceiptReview,
  canSaveReview,
  currencyNotice,
  describeReviewSaveError,
  editReview,
  fieldAccessibilityLabel,
  missingSummary,
  reconcileSelections,
  reviewIssues,
  toExpenseInput,
  visibleStatusLabel,
  type EditableField,
  type ReceiptReview,
  type ReceiptReviewValues,
  type ReviewField,
} from '@/features/receipts/review/receipt-review.model';
import { localDateOf, parseLocalDate } from '@/features/recurring/recurring-schedule';
import {
  accountIcon,
  accountTypeLabel,
  describeDate,
  paymentModeLabels,
} from '@/features/transactions/transaction-entry.presentation';
import {
  discardReceiptDraft,
  getAppSettings,
  getReceiptDraft,
  isLocalFinanceDataAvailable,
  keepReceiptDraftAlive,
  listActiveAccounts,
  listExpenseCategories,
  processReceiptDraft,
  saveReceiptExpense,
} from '@/features/ui/data';
import { useTheme } from '@/theme';
import { parseRouteId } from '@/utils/route-id';

/**
 * Review Receipt: the one gate between a photograph and money.
 *
 * Nothing the receipt said is an expense until the person presses Save
 * Expense, and the screen is built so that stays obvious. Category and account
 * start empty. Only uncertain fields are marked, in words. A date the receipt
 * did not print shows today and says so. And the button names the accounting
 * action it performs rather than something softer.
 *
 * Every decision — what to prefill, what to flag, what counts as saveable,
 * which expense to ask for — is made by `receipt-review.model`. This file lays
 * those decisions out.
 */
export default function ReviewReceiptScreen() {
  const { draftId } = useLocalSearchParams<{ draftId?: string }>();
  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  const id = parseRouteId(typeof draftId === 'string' ? draftId : undefined);
  if (id === null) return <DraftUnavailable />;
  return <ReceiptReviewForm draftId={id} />;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'load_failed' }
  | { kind: 'saved'; transactionId: number }
  | { kind: 'unfinished'; failed: boolean }
  | { kind: 'reading' }
  | { kind: 'review' };

type Selector = 'category' | 'account' | 'paymentMode' | null;

function ReceiptReviewForm({ draftId }: { draftId: number }) {
  const { space } = useTheme();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [review, setReview] = useState<ReceiptReview | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [defaultCurrency, setDefaultCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selector, setSelector] = useState<Selector>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirm, setConfirm] = useState<'discard' | 'rescan' | null>(null);
  const latest = useRef<ReceiptReview | null>(null);
  const loaded = useRef(false);
  const submitting = useRef(false);

  const show = useCallback((next: ReceiptReview) => {
    latest.current = next;
    setReview(next);
  }, []);

  /** Reads the draft once. Coming back to the screen must not reset what was typed. */
  const loadDraft = useCallback(() => {
    try {
      const draft = getReceiptDraft(draftId);
      if (draft === null) {
        setPhase({ kind: 'missing' });
        return;
      }
      if (draft.finalizedTransactionId !== null) {
        // A saved receipt never reopens as an unsaved one.
        setPhase({ kind: 'saved', transactionId: draft.finalizedTransactionId });
        return;
      }
      setImageUri(draft.imageUri);
      if (draft.status !== 'ready_for_review') {
        setPhase({ kind: 'unfinished', failed: draft.status === 'failed' });
        return;
      }
      show(buildReceiptReview(draft, new Date()));
      try {
        setDefaultCurrency(getAppSettings().defaultCurrency);
      } catch {
        // The built-in default stands in; the account's currency decides anyway.
      }
      keepReceiptDraftAlive(draftId);
      setPhase({ kind: 'review' });
    } catch {
      setPhase({ kind: 'load_failed' });
    }
  }, [draftId, show]);

  /**
   * The pickers are reloaded on every return — from Set Up Account, or after a
   * sync archived something. Only a selection that is no longer offered is
   * cleared; the amount, date and note typed so far are never touched.
   */
  const refreshSelections = useCallback(() => {
    try {
      const nextAccounts = listActiveAccounts();
      const nextCategories = listExpenseCategories();
      setAccounts(nextAccounts);
      setCategories(nextCategories);
      const current = latest.current;
      if (current === null) return;
      const reconciled = reconcileSelections(current, {
        accountIds: nextAccounts.map((account) => account.id),
        categoryIds: nextCategories.map((category) => category.id),
      });
      if (reconciled !== current) show(reconciled);
    } catch {
      // The pickers keep what they had. Save Expense validates again regardless.
    }
  }, [show]);

  useFocusEffect(
    useCallback(() => {
      if (!loaded.current) {
        loaded.current = true;
        loadDraft();
      }
      refreshSelections();
    }, [loadDraft, refreshSelections]),
  );

  const update = useCallback(
    <K extends EditableField>(field: K, value: ReceiptReviewValues[K]) => {
      const current = latest.current;
      if (current === null) return;
      show(editReview(current, field, value));
      setSaveError('');
    },
    [show],
  );

  const save = useCallback(async () => {
    const current = latest.current;
    // A second tap while the first is saving does nothing. The draft refuses a
    // second save too, so this is the first line of defence rather than the only one.
    if (current === null || submitting.current) return;
    const input = toExpenseInput(current.values);
    if (input === null) return;

    submitting.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const result = await saveReceiptExpense(draftId, input);
      if (result.status === 'draft_unavailable') {
        setPhase({ kind: 'missing' });
        return;
      }
      toast.show({
        message: result.status === 'saved' ? 'Expense saved' : 'This receipt was already saved',
        tone: 'success',
      });
      router.replace(`/transaction/${result.transactionId}` as never);
    } catch (error) {
      // The draft is untouched, so correcting the refusal and pressing Save
      // Expense again is always possible.
      const described = describeReviewSaveError(error);
      setSaveError(described.message);
      const latestReview = latest.current;
      if (described.clear !== null && latestReview !== null) {
        show(editReview(latestReview, described.clear, null));
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }, [draftId, show, toast]);

  const discard = useCallback(async () => {
    setConfirm(null);
    try {
      await discardReceiptDraft(draftId);
    } catch {
      // Swept later. Discarding never touched any money.
    }
    router.back();
  }, [draftId]);

  const rescan = useCallback(async () => {
    setConfirm(null);
    try {
      await discardReceiptDraft(draftId);
    } catch {
      // Swept later.
    }
    router.replace('/receipt/scan' as never);
  }, [draftId]);

  const enterManually = useCallback(() => {
    discardReceiptDraft(draftId).catch(() => undefined);
    router.replace('/transaction/expense/new' as never);
  }, [draftId]);

  const retryReading = useCallback(async () => {
    setPhase({ kind: 'reading' });
    try {
      await processReceiptDraft(draftId);
    } catch {
      // Reloading shows whatever state reading reached.
    }
    loadDraft();
  }, [draftId, loadDraft]);

  const requestLeave = useCallback(() => {
    if (latest.current?.edited === true) setConfirm('discard');
    else void discard();
  }, [discard]);

  const requestRescan = useCallback(() => {
    if (latest.current?.edited === true) setConfirm('rescan');
    else void rescan();
  }, [rescan]);

  switch (phase.kind) {
    case 'loading':
      return (
        <FormScreen title="Review Receipt" backIcon="x">
          <View />
        </FormScreen>
      );
    case 'reading':
      return (
        <FormScreen title="Review Receipt" backIcon="x">
          <ReceiptReading />
        </FormScreen>
      );
    case 'missing':
      return <DraftUnavailable />;
    case 'load_failed':
      return (
        <FormScreen title="Review Receipt" backIcon="x">
          <ErrorState
            message="This receipt couldn’t be opened. Nothing was saved."
            onRetry={loadDraft}
          />
        </FormScreen>
      );
    case 'saved':
      return (
        <FormScreen title="Review Receipt" backIcon="x">
          <EmptyState
            illustration="ledger"
            title="This receipt is already saved"
            body="It was saved as an expense, so it can’t be saved again."
            action={{
              label: 'View Expense',
              onPress: () => router.replace(`/transaction/${phase.transactionId}` as never),
            }}
          />
        </FormScreen>
      );
    case 'unfinished':
      return (
        <FormScreen title="Review Receipt" backIcon="x" onBack={() => void discard()}>
          <ErrorState
            icon="scan-line"
            title={phase.failed ? 'We couldn’t read this receipt.' : 'This receipt wasn’t finished'}
            message={
              phase.failed
                ? 'Try reading it again, or choose another photo. Nothing was saved.'
                : 'Reading stopped before it finished. Try again, or discard it. Nothing was saved.'
            }
          />
          <View style={{ gap: space.md, marginTop: space.xl }}>
            <Button label="Try Again" onPress={() => void retryReading()} />
            <Button
              label="Choose Another Photo"
              variant="secondary"
              onPress={() => void rescan()}
            />
            <Button label="Enter Expense Manually" variant="secondary" onPress={enterManually} />
            <Button label="Discard" variant="text" onPress={() => void discard()} />
          </View>
        </FormScreen>
      );
    case 'review':
      break;
  }

  if (review === null) return <DraftUnavailable />;

  const { values, fields } = review;
  const issues = reviewIssues(values);
  const ready = canSaveReview(values);
  const account = accounts.find((item) => item.id === values.accountId) ?? null;
  const category = categories.find((item) => item.id === values.categoryId) ?? null;
  const notice = currencyNotice(
    review.currency,
    account === null ? null : { name: account.name, currency: account.currency },
  );
  const summary = missingSummary(issues);
  const amountTyped = values.amountInput.trim() !== '';
  const selectedDate = dateFromLocal(values.transactionDate);
  const today = new Date();

  const categoryOptions: PickerOption<number>[] = categories.map((item) => ({
    value: item.id,
    label: item.name,
    icon: isIconName(item.icon) ? item.icon : 'tag',
  }));
  const accountOptions: PickerOption<number>[] = accounts.map((item) => ({
    value: item.id,
    label: item.name,
    detail: accountTypeLabel(item.type),
    icon: accountIcon(item.type),
  }));
  const paymentModeOptions: PickerOption<PaymentMode>[] = PAYMENT_MODES.map((mode) => ({
    value: mode,
    label: paymentModeLabels[mode],
  }));

  return (
    <FormScreen
      title="Review Receipt"
      backIcon="x"
      onBack={requestLeave}
      footer={
        <View style={{ gap: space.md }}>
          {summary !== null && !saving ? (
            <Text variant="small" tone="secondary" accessibilityLiveRegion="polite">
              {summary}
            </Text>
          ) : null}
          <Button
            label="Save Expense"
            large
            loading={saving}
            disabled={!ready || saving}
            onPress={() => void save()}
          />
        </View>
      }
    >
      <View style={[styles.header, { gap: space.lg, marginBottom: space.xl }]}>
        <ReceiptPhoto uri={imageUri} />
        <View style={[styles.headerText, { gap: space.md }]}>
          <Text variant="body" tone="secondary">
            Check the detected details before saving. Nothing is saved until you press Save Expense.
          </Text>
          <Button label="Scan Again" variant="text" icon="scan-line" onPress={requestRescan} />
        </View>
      </View>

      {saveError !== '' ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner tone="negative" message={saveError} />
        </View>
      ) : null}

      <AmountInput
        value={values.amountInput}
        onChangeText={(text) => update('amountInput', text)}
        currency={account?.currency ?? review.currency.code ?? defaultCurrency}
        direction="expense"
        error={amountTyped ? issues.amount : undefined}
      />
      <FieldNote label="Amount" field={fields.amount} required empty={!amountTyped} />

      <View style={{ marginTop: space.xl, gap: space.md }}>
        {notice !== null ? <Banner icon="triangle-alert" message={notice} /> : null}

        <SelectorField
          label="Category"
          value={category?.name}
          placeholder="Required"
          icon={category !== null && isIconName(category.icon) ? category.icon : undefined}
          onPress={() => setSelector('category')}
        />

        {accounts.length === 0 ? (
          <View style={{ gap: space.md }}>
            <Text variant="body" tone="secondary">
              You need an account before saving this expense.
            </Text>
            <Button
              label="Set Up Account"
              variant="secondary"
              onPress={() => router.push('/accounts/new' as never)}
            />
          </View>
        ) : (
          <SelectorField
            label="Account"
            value={account?.name}
            placeholder="Required"
            icon={account !== null ? accountIcon(account.type) : undefined}
            onPress={() => setSelector('account')}
          />
        )}

        <View>
          <SelectorField
            label="Date"
            value={describeDate(selectedDate)}
            onPress={() => setShowDatePicker(true)}
          />
          <FieldNote label="Date" field={fields.transactionDate} required={false} empty={false} />
        </View>

        <View>
          <TextField
            label="Merchant / Note"
            placeholder="Optional"
            multiline
            value={values.note}
            onChangeText={(text) => update('note', text)}
          />
          <FieldNote
            label="Merchant / Note"
            field={fields.note}
            required={false}
            empty={values.note === ''}
          />
        </View>

        <View>
          <SelectorField
            label="Payment Mode"
            value={values.paymentMode !== null ? paymentModeLabels[values.paymentMode] : undefined}
            placeholder="Optional"
            onPress={() => setSelector('paymentMode')}
          />
          <FieldNote
            label="Payment Mode"
            field={fields.paymentMode}
            required={false}
            empty={values.paymentMode === null}
          />
        </View>
      </View>

      {showDatePicker ? (
        <DateTimePicker
          mode="date"
          value={selectedDate}
          // A receipt dated after today is allowed to be shown, and corrected.
          maximumDate={selectedDate > today ? selectedDate : today}
          onChange={(_event, date) => {
            setShowDatePicker(false);
            if (date) update('transactionDate', localDateOf(date));
          }}
        />
      ) : null}

      <PickerSheet
        visible={selector === 'category'}
        onClose={() => setSelector(null)}
        title="Choose category"
        options={categoryOptions}
        selected={values.categoryId ?? undefined}
        onSelect={(id) => update('categoryId', id)}
      />
      <PickerSheet
        visible={selector === 'account'}
        onClose={() => setSelector(null)}
        title="Choose account"
        options={accountOptions}
        selected={values.accountId ?? undefined}
        onSelect={(id) => update('accountId', id)}
        footer={{ label: 'Add Account', onPress: () => router.push('/accounts/new' as never) }}
      />
      <PickerSheet
        visible={selector === 'paymentMode'}
        onClose={() => setSelector(null)}
        title="Payment mode"
        options={paymentModeOptions}
        selected={values.paymentMode ?? undefined}
        clearOption={{ label: 'None', onSelect: () => update('paymentMode', null) }}
        onSelect={(mode) => update('paymentMode', mode)}
      />

      <Dialog
        visible={confirm !== null}
        title={confirm === 'rescan' ? 'Scan again?' : 'Discard this receipt draft?'}
        message={
          confirm === 'rescan'
            ? 'Your changes to this receipt will be lost. No expense has been saved.'
            : 'Your changes will be lost. No expense has been saved.'
        }
        confirmLabel={confirm === 'rescan' ? 'Scan Again' : 'Discard'}
        destructive
        onConfirm={() => void (confirm === 'rescan' ? rescan() : discard())}
        onCancel={() => setConfirm(null)}
      />
    </FormScreen>
  );
}

/**
 * What a field's value is worth, in words. Silent for a confident reading;
 * otherwise "Needs review" or "Not detected", with the reason when there is one.
 * A screen reader hears the field's name with it — "Amount, needs review".
 */
function FieldNote({
  label,
  field,
  required,
  empty,
}: {
  label: string;
  field: ReviewField;
  required: boolean;
  empty: boolean;
}) {
  const { palette, space } = useTheme();
  const visible = visibleStatusLabel(field);
  if (visible === null && field.hint === null) return null;

  const spoken = [fieldAccessibilityLabel(label, field, { required, empty }), field.hint]
    .filter((part): part is string => part !== null)
    .join('. ');
  const written = [visible, field.hint].filter((part): part is string => part !== null).join(' · ');

  return (
    <View
      accessible
      accessibilityLabel={spoken}
      style={[styles.note, { gap: space.md, marginTop: space.md }]}
    >
      {visible !== null ? (
        <Icon
          name={field.status === 'needs_review' ? 'triangle-alert' : 'circle-dashed'}
          size="inline"
          color={field.status === 'needs_review' ? palette.warning : palette.textTertiary}
        />
      ) : null}
      <Text variant="small" tone="secondary" style={styles.noteText}>
        {written}
      </Text>
    </View>
  );
}

/**
 * The receipt, as context beside the form. Rendered at a fixed, small size and
 * downsampled by the platform, so a 12-megapixel photo never becomes a
 * full-resolution bitmap in memory just to be glanced at.
 */
function ReceiptPhoto({ uri }: { uri: string | null }) {
  const { palette, radius, size } = useTheme();
  const [failed, setFailed] = useState(false);
  const frame = {
    width: size.receiptPreview.width,
    height: size.receiptPreview.height,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
    backgroundColor: palette.surface,
  };

  // The cache may have been emptied since the scan. The extracted details are
  // still reviewable; only the picture is gone.
  if (uri === null || failed) {
    return (
      <View
        accessible
        accessibilityLabel="Receipt photo, no longer available"
        style={[styles.photoFallback, frame]}
      >
        <Icon name="image" color={palette.textTertiary} />
      </View>
    );
  }
  return (
    <Image
      accessible
      accessibilityLabel="Receipt photo"
      source={{ uri }}
      resizeMode="contain"
      resizeMethod="resize"
      onError={() => setFailed(true)}
      style={frame}
    />
  );
}

function DraftUnavailable() {
  const { space } = useTheme();
  return (
    <FormScreen title="Review Receipt" backIcon="x">
      <EmptyState
        illustration="ledger"
        title="This receipt draft is no longer available."
        body="It may have been saved, discarded or cleared. Nothing was lost from your accounts."
        action={{
          label: 'Scan Another Receipt',
          onPress: () => router.replace('/receipt/scan' as never),
        }}
      />
      <View style={{ marginTop: space.lg }}>
        <Button
          label="Add Expense Manually"
          variant="text"
          onPress={() => router.replace('/transaction/expense/new' as never)}
        />
      </View>
    </FormScreen>
  );
}

function dateFromLocal(value: string): Date {
  const { year, month, day } = parseLocalDate(value);
  return new Date(year, month - 1, day);
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  headerText: { flex: 1 },
  note: { flexDirection: 'row', alignItems: 'flex-start' },
  noteText: { flex: 1 },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
});
