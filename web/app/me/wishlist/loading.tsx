// Suspense boundary for this route — see components/PageSkeleton. The page asks the bot for the member's own
// pre-bids, one call per character with a list, so the skeleton is not decoration.
import PageSkeleton from '@/components/PageSkeleton';

export default function Loading() {
  return <PageSkeleton rows={6} />;
}
