import { ErrorState, FormScreen } from '@/components/ui';

/** A route whose id could not be read. Nothing is looked up for it. */
export function InvalidLink({ title }: { title: string }) {
  return (
    <FormScreen title={title} backIcon="x">
      <ErrorState title="Investment unavailable" message="This link is invalid." />
    </FormScreen>
  );
}
