// Suspense boundary for this route — see components/PageSkeleton.
import PageSkeleton from '@/components/PageSkeleton';

export default function Loading() {
  return <PageSkeleton rows={10} />;
}
