'use client';

// Smart link to the LOCAL agent dashboard. Two clients can serve it:
//   - Parser.bat  → http://127.0.0.1:7777 (legacy default)
//   - Mimic       → http://127.0.0.1:7779 (and up if 7779 is taken)
//
// A member running only Mimic would get nothing from a hardcoded :7777 link.
// This probes the likely ports client-side and links to whichever is actually
// answering, falling back to :7777 (the documented default) when none respond
// — e.g. the agent isn't running yet.
import { useEffect, useState } from 'react';

const CANDIDATE_PORTS = [7777, 7778, 7779, 7780];

async function probe(port: number, signal: AbortSignal): Promise<boolean> {
  try {
    // The agent serves /api/state on its dashboard port. no-cors keeps the
    // browser from blocking the cross-origin localhost request; we can't read
    // the body but a resolved fetch (opaque response) means something answered.
    await fetch(`http://127.0.0.1:${port}/api/state`, { mode: 'no-cors', signal });
    return true;
  } catch {
    return false;
  }
}

export default function LocalDashboardLink() {
  const [port, setPort] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      for (const p of CANDIDATE_PORTS) {
        if (await probe(p, ctrl.signal)) { setPort(p); break; }
      }
      setChecked(true);
    })();
    return () => ctrl.abort();
  }, []);

  // Until a probe lands, link to the documented default so the link is never
  // dead; swap to the live port once found.
  const target = port ?? 7777;
  const label = port
    ? `http://localhost:${port}`
    : (checked ? 'http://localhost:7777' : 'http://localhost:7777');

  return (
    <a
      href={`http://localhost:${target}`}
      target="_blank"
      rel="noreferrer"
      className="text-blue hover:underline"
      title={port
        ? `Live agent detected on port ${port}`
        : 'Default Parser.bat port — opens only if your agent is running there'}
    >
      {label}
    </a>
  );
}
