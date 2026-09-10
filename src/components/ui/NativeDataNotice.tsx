import { EmptyState } from './EmptyState';

export function NativeDataNotice() {
  return (
    <EmptyState
      illustration="card"
      title="Available in the mobile app"
      body="Your local finance data is read on this device. Open the Android or iOS app to see it."
    />
  );
}
