// Link to the LOCAL agent dashboard. Two clients can serve it:
//   - Parser.bat  → http://localhost:7777 (legacy default)
//   - Mimic       → http://localhost:7779 (and up if 7779 is taken)
//
// We deliberately DON'T probe the ports anymore. A client-side fetch from a
// public origin (wolfpack.quest) to a localhost address now trips Chrome's
// "Local Network Access" permission gate — the "wolfpack.quest wants to access
// other apps and services on this device" prompt — on every single page load.
// A plain link NAVIGATION to localhost does not trip it, so we just render
// static links to both documented ports and let the user click the one their
// client uses. No prompt, no probe. (Server component — no client JS needed.)
export default function LocalDashboardLink() {
  return (
    <span>
      <a
        href="http://localhost:7779"
        target="_blank"
        rel="noreferrer"
        className="text-blue hover:underline"
        title="Mimic dashboard (default port 7779)"
      >
        localhost:7779
      </a>
      <span className="text-dim"> (Mimic) · </span>
      <a
        href="http://localhost:7777"
        target="_blank"
        rel="noreferrer"
        className="text-blue hover:underline"
        title="Parser.bat dashboard (default port 7777)"
      >
        7777
      </a>
      <span className="text-dim"> (Parser.bat)</span>
    </span>
  );
}
