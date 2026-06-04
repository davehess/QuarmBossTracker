// Link to the LOCAL Mimic Parser dashboard at http://localhost:7779.
//
// We deliberately DON'T probe the port. A client-side fetch from a public
// origin (wolfpack.quest) to a localhost address trips Chrome's "Local Network
// Access" permission gate — the "wolfpack.quest wants to access other apps and
// services on this device" prompt — on every page load. A plain link
// NAVIGATION to localhost does not trip it, so we render a static link and let
// the user click it. (Server component — no client JS needed.)
export default function LocalDashboardLink() {
  return (
    <a
      href="http://localhost:7779"
      target="_blank"
      rel="noreferrer"
      className="text-blue hover:underline"
      title="Mimic Parser dashboard (default port 7779)"
    >
      localhost:7779
    </a>
  );
}
