// Shared loading skeleton for /character/[name] and all its sub-pages (gear,
// spells, quests, factions, inventory). These are all `force-dynamic` and some
// (the missing-spells RPC especially) take a beat server-side. Without a
// loading boundary a soft-nav <Link> click sits on the OLD page with zero
// feedback until the new RSC is fully rendered — which reads as "it just spins"
// even though a direct URL load (browser shows its own progress) feels fine.
// This Suspense fallback makes the transition instant and streams the page in.
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading…">
      <div className="h-4 w-40 bg-panel rounded" />
      <section className="bg-panel border border-border rounded-lg p-6 space-y-3">
        <div className="h-6 w-64 bg-bg rounded" />
        <div className="h-3 w-full max-w-xl bg-bg rounded" />
        <div className="h-3 w-3/4 max-w-lg bg-bg rounded" />
        <div className="flex gap-3 pt-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 w-20 bg-bg rounded" />
          ))}
        </div>
      </section>
      <section className="bg-panel border border-border rounded-lg p-5 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-3 w-full bg-bg rounded" />
        ))}
      </section>
    </div>
  );
}
