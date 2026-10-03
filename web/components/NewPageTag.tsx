// The [beta] tag at the top of a page that is new on production (the guild lead, 2026-10-03,
// DECISIONS §135): "push them up to live to start if it's a new page that didn't exist previously,
// and mark the page as a [beta] at the top so people know it's new." A new route ships to main
// with this on it; it comes off when the guild lead says the page is settled. Changes to pages that
// already exist still go to b.wolfpack.quest first, so they never carry this tag.
//
// Server component, no JS. The page title carries the same "[beta]" prefix.
export default function NewPageTag({ note = 'New page, still being shaped.' }: { note?: string }) {
  return (
    <div role="note" className="mb-4 flex flex-wrap items-center gap-x-2 rounded-md border border-orange/50 bg-orange/10 px-3 py-1.5 font-mono text-xs text-orange">
      <b className="tracking-wider">[beta]</b>
      <span>
        {note} Tell us what you think on <a href="/feedback" className="underline hover:text-text">feedback</a>.
      </span>
    </div>
  );
}
