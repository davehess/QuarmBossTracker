// The one loading skeleton, shared by every route's loading.tsx.
//
// Extracted from /character/[name]/loading.tsx, which was the only loading
// boundary in the app — 1 route out of 84, all of them Supabase-backed and read
// on phones between pulls. Without a boundary a soft-nav <Link> click sits on the
// OLD page with no feedback until the new RSC has fully rendered, which reads as
// "it just spins" even when the server was quick.
//
// One component rather than a copy per route: twelve hand-maintained skeletons
// drift, and a skeleton that no longer resembles its page is worse than none —
// it promises a layout that never arrives.
export default function PageSkeleton({
  rows = 6, header = true,
}: { rows?: number; header?: boolean }) {
  return (
    // aria-busy + a label so a screen reader announces the wait instead of
    // reading out a screenful of empty boxes.
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading…">
      <div className="h-4 w-40 bg-panel rounded" />
      {header && (
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
      )}
      <section className="bg-panel border border-border rounded-lg p-5 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-3 w-full bg-bg rounded" />
        ))}
      </section>
    </div>
  );
}
