'use client';

// "Take the tour" on the /me hub. It starts the existing ✨ walkthrough the way the header's TourLauncher does: by firing
// the DOM event GuidedTour (mounted in the root layout) listens for. The tour itself is not touched.
export default function HubTourButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('wp-tour-start'))}
      className="inline-flex min-h-[40px] items-center rounded border border-border bg-bg px-3 text-sm text-text hover:bg-[#21262d]"
    >
      <span aria-hidden>✨</span>&nbsp;Take the tour
    </button>
  );
}
