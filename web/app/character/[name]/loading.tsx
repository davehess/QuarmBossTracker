// Shared loading skeleton for /character/[name] and all its sub-pages (gear,
// spells, quests, factions, inventory). These are all `force-dynamic` and some
// (the missing-spells RPC especially) take a beat server-side. Without a
// loading boundary a soft-nav <Link> click sits on the OLD page with zero
// feedback until the new RSC is fully rendered — which reads as "it just spins"
// even though a direct URL load (browser shows its own progress) feels fine.
// This Suspense fallback makes the transition instant and streams the page in.
import PageSkeleton from '@/components/PageSkeleton';

export default function Loading() {
  return <PageSkeleton />;
}
