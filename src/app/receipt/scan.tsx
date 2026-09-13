import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormScreen,
  ListRow,
  NativeDataNotice,
  Screen,
  Text,
} from '@/components/ui';
import type { ReceiptFailureReason } from '@/features/receipts/receipt.types';
import { ReceiptReading } from '@/features/receipts/scanner/ReceiptReading';
import {
  draftOf,
  initialScanner,
  scannerReducer,
  type CaptureSummary,
  type ProcessingSummary,
  type ReceiptSource,
  type Scanner,
  type ScannerEvent,
} from '@/features/receipts/scanner/receipt-scanner.state';
import {
  captureReceiptFromCamera,
  cleanupExpiredReceiptDrafts,
  discardReceiptDraft,
  importReceiptFromLibrary,
  isLocalFinanceDataAvailable,
  isReceiptScanningAvailable,
  processReceiptDraft,
  registerCapturedReceipt,
} from '@/features/ui/data';
import { useTheme } from '@/theme';

/**
 * Scan Receipt: from the choice of source to a draft ready for review.
 *
 * Every state this screen can show is one variant of the scanner reducer, and
 * the screen's own job is only to do what the state asks — open a picker, read
 * the photo, hand over to Review Receipt — and report back. Nothing here saves
 * anything. The most this screen can leave behind is a draft, and it discards
 * that too when someone walks away.
 */
export default function ScanReceiptScreen() {
  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }
  return <ReceiptScanner />;
}

function ReceiptScanner() {
  const { space } = useTheme();
  const [scanner, setScanner] = useState<Scanner>(initialScanner);
  const latest = useRef<Scanner>(initialScanner);
  const [available] = useState(() => isReceiptScanningAvailable());

  /** Applies an event and returns the result at once, so an async step knows its own run. */
  const dispatch = useCallback((event: ScannerEvent): Scanner => {
    const next = scannerReducer(latest.current, event);
    latest.current = next;
    setScanner(next);
    return next;
  }, []);

  // Drafts left behind by scans nobody finished are swept whenever scanning
  // starts. Local, cheap, and never in the way.
  useEffect(() => {
    cleanupExpiredReceiptDrafts().catch(() => undefined);
  }, []);

  // Leaving by any route — the close button, a back gesture — retires the run,
  // so a read still in flight finishes into nothing and cannot pull anyone back
  // into a review. A draft that never reached review is discarded with it.
  useEffect(
    () => () => {
      const state = latest.current.state;
      latest.current = scannerReducer(latest.current, { type: 'cancel' });
      if (state.status !== 'ready') release(draftOf(state));
    },
    [],
  );

  const read = useCallback(
    async (draftId: number, run: number) => {
      let result: ProcessingSummary;
      try {
        const outcome = await processReceiptDraft(draftId);
        result =
          outcome.status === 'ready_for_review'
            ? { status: 'ready_for_review' }
            : outcome.status === 'failed'
              ? { status: 'failed', reason: outcome.reason }
              : { status: 'superseded' };
      } catch {
        result = { status: 'failed', reason: 'ocr_failed' };
      }
      const next = dispatch({ type: 'processing_finished', run, draftId, result });
      if (next.run === run && next.state.status === 'ready') {
        // Only the draft id travels. The photo and anything read from it stay
        // out of the route, where they could end up in a log or a deep link.
        router.replace(`/receipt/review/${draftId}` as never);
      }
    },
    [dispatch],
  );

  const start = useCallback(
    async (source: ReceiptSource) => {
      const opened = dispatch({ type: 'choose_source', source });
      if (opened.state.status !== 'capturing') return;
      const run = opened.run;

      let result: CaptureSummary;
      try {
        const outcome =
          source === 'camera' ? await captureReceiptFromCamera() : await importReceiptFromLibrary();
        switch (outcome.status) {
          case 'captured':
            result = { status: 'captured', draftId: registerCapturedReceipt(outcome.asset.uri).id };
            break;
          case 'cancelled':
            result = { status: 'cancelled' };
            break;
          case 'permission_denied':
            result = { status: 'permission_denied' };
            break;
          case 'unsupported_image':
            result = { status: 'unsupported_image' };
            break;
          case 'unavailable':
            result = { status: 'unavailable' };
            break;
        }
      } catch {
        result = { status: 'unavailable' };
      }

      const next = dispatch({ type: 'capture_finished', run, result });
      if (result.status !== 'captured') return;
      if (
        next.run === run &&
        next.state.status === 'processing' &&
        next.state.draftId === result.draftId
      ) {
        await read(result.draftId, run);
      } else {
        // The scanner moved on while the picker was open. The photo is nobody's.
        release(result.draftId);
      }
    },
    [dispatch, read],
  );

  const retry = useCallback(() => {
    const next = dispatch({ type: 'retry' });
    if (next.state.status === 'processing') void read(next.state.draftId, next.run);
  }, [dispatch, read]);

  const chooseAnother = useCallback(() => {
    const draftId = draftOf(latest.current.state);
    dispatch({ type: 'choose_another' });
    release(draftId);
  }, [dispatch]);

  const leave = useCallback(() => {
    const draftId = draftOf(latest.current.state);
    dispatch({ type: 'cancel' });
    release(draftId);
    router.back();
  }, [dispatch]);

  const enterManually = useCallback(() => {
    const draftId = draftOf(latest.current.state);
    dispatch({ type: 'cancel' });
    release(draftId);
    // The ordinary Add Expense form. There is no second manual expense form.
    router.replace('/transaction/expense/new' as never);
  }, [dispatch]);

  const state = scanner.state;

  if (!available || state.status === 'unavailable') {
    return (
      <FormScreen title="Scan Receipt" backIcon="x" onBack={leave}>
        <EmptyState
          illustration="ledger"
          title="Receipt scanning isn’t available"
          body="This device can’t read receipts right now. You can still add the expense yourself."
          action={{ label: 'Add Expense', onPress: enterManually }}
        />
      </FormScreen>
    );
  }

  switch (state.status) {
    case 'selecting_source':
    case 'capturing': {
      const busy = state.status === 'capturing';
      return (
        <FormScreen title="Scan Receipt" backIcon="x" onBack={leave}>
          <Text variant="body" tone="secondary">
            Photograph a receipt, or choose one you already took. You’ll check every detail before
            anything is saved.
          </Text>
          <Card padding="none" style={{ marginTop: space.xl }}>
            <ListRow
              icon="camera"
              label="Take Photo"
              detail="Use the camera"
              disabled={busy}
              onPress={() => void start('camera')}
            />
            <ListRow
              icon="image"
              label="Choose from Photos"
              detail="A receipt already in your photos"
              disabled={busy}
              onPress={() => void start('library')}
              last
            />
          </Card>
          <Actions>
            <Button label="Cancel" variant="text" onPress={leave} />
          </Actions>
        </FormScreen>
      );
    }

    case 'processing':
    case 'ready':
    case 'cancelled':
      return (
        <FormScreen title="Scan Receipt" backIcon="x" onBack={leave}>
          <ReceiptReading />
          {state.status === 'processing' ? (
            <Button label="Cancel" variant="text" onPress={leave} />
          ) : null}
        </FormScreen>
      );

    case 'permission_denied': {
      const camera = state.source === 'camera';
      return (
        <FormScreen title="Scan Receipt" backIcon="x" onBack={leave}>
          <ErrorState
            icon={camera ? 'camera' : 'image'}
            title={camera ? 'Camera access is off' : 'Photo access is off'}
            message={
              camera
                ? 'Camera access is needed to take a receipt photo. You can choose one from your photos instead, or allow the camera in Settings.'
                : 'Photo access is needed to choose a receipt photo. You can take one with the camera instead, or allow access in Settings.'
            }
          />
          <Actions>
            <Button
              label={camera ? 'Choose from Photos' : 'Take Photo'}
              onPress={() => void start(camera ? 'library' : 'camera')}
            />
            <Button
              label="Open Settings"
              variant="secondary"
              onPress={() => {
                Linking.openSettings().catch(() => undefined);
              }}
            />
            <Button label="Cancel" variant="text" onPress={leave} />
          </Actions>
        </FormScreen>
      );
    }

    case 'unsupported_image':
      return (
        <FormScreen title="Scan Receipt" backIcon="x" onBack={leave}>
          <ErrorState
            icon="image"
            title="This file can’t be scanned"
            message="Choose a JPEG, PNG or HEIC photo of the receipt, under 25 MB. PDF receipts can’t be scanned."
          />
          <Actions>
            <Button label="Choose Another Photo" onPress={chooseAnother} />
            <Button label="Enter Expense Manually" variant="secondary" onPress={enterManually} />
            <Button label="Cancel" variant="text" onPress={leave} />
          </Actions>
        </FormScreen>
      );

    case 'failed':
      return (
        <FormScreen title="Scan Receipt" backIcon="x" onBack={leave}>
          <ErrorState
            icon="scan-line"
            title="We couldn’t read this receipt."
            message={failureMessage(state.reason)}
          />
          <Actions>
            {state.canRetry ? <Button label="Try Again" onPress={retry} /> : null}
            <Button
              label="Choose Another Photo"
              variant={state.canRetry ? 'secondary' : 'primary'}
              onPress={chooseAnother}
            />
            <Button label="Enter Expense Manually" variant="secondary" onPress={enterManually} />
            <Button label="Cancel" variant="text" onPress={leave} />
          </Actions>
        </FormScreen>
      );
  }
}

function Actions({ children }: { children: ReactNode }) {
  const { space } = useTheme();
  return <View style={{ gap: space.md, marginTop: space.xl }}>{children}</View>;
}

function failureMessage(reason: ReceiptFailureReason): string {
  switch (reason) {
    case 'no_text_detected':
      return 'No text could be found in this photo. A flat, well-lit photo of the whole receipt reads best.';
    case 'image_unavailable':
      return 'The photo is no longer on this device. Take a new one or choose it again.';
    default:
      return 'Something went wrong while reading it. Nothing was saved.';
  }
}

/**
 * Throws away a draft nobody will review. Housekeeping only: a draft that
 * fails to go is swept later, and it never moved any money either way.
 */
function release(draftId: number | null): void {
  if (draftId === null) return;
  discardReceiptDraft(draftId).catch(() => undefined);
}
