// Suspense boundary for this route — see components/PageSkeleton. The first load after a deploy also reads the
// item pool (about 14k rows), so the skeleton is not decoration.
import PageSkeleton from '@/components/PageSkeleton';

export default function Loading() {
  return <PageSkeleton rows={8} />;
}
