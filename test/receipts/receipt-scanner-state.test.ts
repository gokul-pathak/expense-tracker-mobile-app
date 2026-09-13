import { describe, expect, it } from 'vitest';

import {
  draftOf,
  initialScanner,
  scannerReducer,
  type Scanner,
  type ScannerEvent,
} from '@/features/receipts/scanner/receipt-scanner.state';

/**
 * Every transition Scan Receipt can make, without a camera.
 *
 * The screen is a thin arrangement of this reducer: it opens a picker when the
 * state says capturing, reads the receipt when it says processing, and moves
 * to Review Receipt when it says ready. So the flow the milestone specifies —
 * source, capture, processing, review or error — is pinned here, including the
 * two races that matter: a result arriving after someone left, and a result
 * from a run that a retry has already replaced.
 */

function run(...events: ScannerEvent[]): Scanner {
  return events.reduce(scannerReducer, initialScanner);
}

const captured = (runNumber: number, draftId = 42): ScannerEvent => ({
  type: 'capture_finished',
  run: runNumber,
  result: { status: 'captured', draftId },
});

describe('choosing a source', () => {
  it('starts on the choice, and opens a capture when one is made', () => {
    expect(initialScanner.state).toEqual({ status: 'selecting_source' });

    const scanner = run({ type: 'choose_source', source: 'camera' });
    expect(scanner.state).toEqual({ status: 'capturing', source: 'camera' });
    expect(scanner.run).toBe(1);
  });

  it('never opens a second capture on top of one already open', () => {
    const open = run({ type: 'choose_source', source: 'camera' });
    expect(scannerReducer(open, { type: 'choose_source', source: 'library' })).toBe(open);
  });

  it('treats a cancelled camera as a return to the choice, not a failure', () => {
    const scanner = run(
      { type: 'choose_source', source: 'camera' },
      { type: 'capture_finished', run: 1, result: { status: 'cancelled' } },
    );
    expect(scanner.state).toEqual({ status: 'selecting_source' });
  });

  it('leaves when the choice itself is cancelled', () => {
    expect(run({ type: 'cancel' }).state).toEqual({ status: 'cancelled' });
  });
});

describe('a refused camera', () => {
  it('says so, and lets the photo library be chosen instead', () => {
    const denied = run(
      { type: 'choose_source', source: 'camera' },
      { type: 'capture_finished', run: 1, result: { status: 'permission_denied' } },
    );
    expect(denied.state).toEqual({ status: 'permission_denied', source: 'camera' });

    const library = scannerReducer(denied, { type: 'choose_source', source: 'library' });
    expect(library.state).toEqual({ status: 'capturing', source: 'library' });
  });

  it('reports an image that is not a receipt photo, and offers another', () => {
    const refused = run(
      { type: 'choose_source', source: 'library' },
      { type: 'capture_finished', run: 1, result: { status: 'unsupported_image' } },
    );
    expect(refused.state).toEqual({ status: 'unsupported_image' });
    expect(scannerReducer(refused, { type: 'choose_another' }).state).toEqual({
      status: 'selecting_source',
    });
  });
});

describe('reading the receipt', () => {
  it('moves from capture to processing to review', () => {
    const processing = run({ type: 'choose_source', source: 'camera' }, captured(1));
    expect(processing.state).toEqual({ status: 'processing', source: 'camera', draftId: 42 });

    const ready = scannerReducer(processing, {
      type: 'processing_finished',
      run: 1,
      draftId: 42,
      result: { status: 'ready_for_review' },
    });
    expect(ready.state).toEqual({ status: 'ready', draftId: 42 });
    expect(draftOf(ready.state)).toBe(42);
  });

  it('turns an unreadable photo into a retryable failure, not a zero expense', () => {
    const failed = run({ type: 'choose_source', source: 'camera' }, captured(1), {
      type: 'processing_finished',
      run: 1,
      draftId: 42,
      result: { status: 'failed', reason: 'no_text_detected' },
    });
    expect(failed.state).toEqual({
      status: 'failed',
      source: 'camera',
      draftId: 42,
      reason: 'no_text_detected',
      canRetry: true,
    });
  });

  it('retries the same draft rather than starting another', () => {
    const failed = run({ type: 'choose_source', source: 'camera' }, captured(1), {
      type: 'processing_finished',
      run: 1,
      draftId: 42,
      result: { status: 'failed', reason: 'ocr_failed' },
    });

    const retried = scannerReducer(failed, { type: 'retry' });
    expect(retried.state).toEqual({ status: 'processing', source: 'camera', draftId: 42 });
    expect(retried.run).toBe(failed.run + 1);
  });

  it('does not offer to re-read a photo that is gone', () => {
    const failed = run({ type: 'choose_source', source: 'camera' }, captured(1), {
      type: 'processing_finished',
      run: 1,
      draftId: 42,
      result: { status: 'failed', reason: 'image_unavailable' },
    });
    if (failed.state.status !== 'failed') throw new Error('expected failed');
    expect(failed.state.canRetry).toBe(false);
    expect(scannerReducer(failed, { type: 'retry' })).toBe(failed);
  });

  it('reports a build with no OCR engine as unavailable, not as this receipt failing', () => {
    const scanner = run({ type: 'choose_source', source: 'camera' }, captured(1), {
      type: 'processing_finished',
      run: 1,
      draftId: 42,
      result: { status: 'failed', reason: 'ocr_provider_unavailable' },
    });
    expect(scanner.state).toEqual({ status: 'unavailable' });
  });

  it('keeps waiting when another run has taken the draft over', () => {
    const processing = run({ type: 'choose_source', source: 'camera' }, captured(1));
    const after = scannerReducer(processing, {
      type: 'processing_finished',
      run: 1,
      draftId: 42,
      result: { status: 'superseded' },
    });
    expect(after).toBe(processing);
  });
});

describe('stale results', () => {
  it('ignores a reading that finishes after the person has left', () => {
    const processing = run({ type: 'choose_source', source: 'camera' }, captured(1));
    const left = scannerReducer(processing, { type: 'cancel' });

    // The slow OCR run started under run 1 comes back.
    const late = scannerReducer(left, {
      type: 'processing_finished',
      run: 1,
      draftId: 42,
      result: { status: 'ready_for_review' },
    });

    // They are not pulled back into a review they walked away from.
    expect(late.state).toEqual({ status: 'cancelled' });
  });

  it('ignores the first attempt once a retry has replaced it', () => {
    const failed = run({ type: 'choose_source', source: 'camera' }, captured(1), {
      type: 'processing_finished',
      run: 1,
      draftId: 42,
      result: { status: 'failed', reason: 'ocr_failed' },
    });
    const retrying = scannerReducer(failed, { type: 'retry' });

    const stale = scannerReducer(retrying, {
      type: 'processing_finished',
      run: 1,
      draftId: 42,
      result: { status: 'ready_for_review' },
    });
    expect(stale).toBe(retrying);
  });

  it('ignores a capture result from a picker that was superseded', () => {
    const first = run(
      { type: 'choose_source', source: 'camera' },
      { type: 'capture_finished', run: 1, result: { status: 'permission_denied' } },
      { type: 'choose_source', source: 'library' },
    );
    // The camera's run was 1; the library is now run 2.
    expect(scannerReducer(first, captured(1)).state).toEqual({
      status: 'capturing',
      source: 'library',
    });
    expect(scannerReducer(first, captured(2, 7)).state).toEqual({
      status: 'processing',
      source: 'library',
      draftId: 7,
    });
  });

  it('ignores a result for a different draft', () => {
    const processing = run({ type: 'choose_source', source: 'camera' }, captured(1, 42));
    const other = scannerReducer(processing, {
      type: 'processing_finished',
      run: 1,
      draftId: 99,
      result: { status: 'ready_for_review' },
    });
    expect(other).toBe(processing);
  });
});
