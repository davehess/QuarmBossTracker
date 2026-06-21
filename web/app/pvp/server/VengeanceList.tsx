'use client';

// /pvp/server's vengeance list — one row per non-WP killer who's killed
// Wolf Pack members. Each row has a "📋 Copy" button that drops a short
// in-game-ready line into the clipboard:
//
//   "I have avenged a Wolf Pack member's death by your hand. N vengeance
//    kills remaining"
//
// The N reflects the OUTSTANDING DEBT *after* the kill the user is about
// to land — i.e. killsAgainstWP − (killsByWP + 1), clamped at 0. When you
// hit it square (debt → 0) the message reads "0 vengeance kills
// remaining" as a final declaration; when there's still debt, it lets
// the target know we're not done yet.

import { useState } from 'react';

type Row = {
  killer:           string;
  killer_guild:     string | null;
  killsAgainstWP:   number;
  killsByWP:        number;
  vengeanceOwed:    number;     // current outstanding debt: max(0, killsAgainstWP − killsByWP)
  lastWpVictimAt:   string;
};

export default function VengeanceList({ rows }: { rows: Row[] }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copyFor(r: Row) {
    const remainingAfter = Math.max(0, r.vengeanceOwed - 1);
    const text = `I have avenged a Wolf Pack member's death by your hand. ${remainingAfter} vengeance kills remaining`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(r.killer.toLowerCase());
      setTimeout(() => setCopiedKey(null), 1800);
    }).catch(() => {
      // Clipboard API failure — fall through silently. (No fallback needed —
      // the row stays visible so the user can still type it out.)
    });
  }

  if (rows.length === 0) {
    return (
      <div className="text-sm text-dim italic">
        No outstanding vengeance. Either nobody&apos;s killed a Wolf Pack member yet,
        or we&apos;ve evened the score with everyone who has.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-dim text-left">
          <tr className="border-b border-border">
            <th className="py-1 pr-2 w-8">#</th>
            <th className="py-1 pr-2">Target</th>
            <th className="py-1 pr-2">Guild</th>
            <th className="py-1 pr-2 text-right" title="Kills they've landed against Wolf Pack members">
              <span className="text-red-400">vs WP</span>
            </th>
            <th className="py-1 pr-2 text-right" title="Wolf Pack kills against this target">
              <span className="text-green">WP back</span>
            </th>
            <th className="py-1 pr-2 text-right" title="Outstanding debt (killsAgainstWP − killsByWP)">
              <span className="text-gold">Owed</span>
            </th>
            <th className="py-1 pr-2 text-right">Latest WP kill</th>
            <th className="py-1 pr-2 text-right w-28">Copy line</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const lk = r.killer.toLowerCase();
            const wasCopied = copiedKey === lk;
            return (
              <tr key={r.killer} className="border-b border-border/30 hover:bg-[#1a212c]">
                <td className="py-1 pr-2 text-dim">{i + 1}</td>
                <td className="py-1 pr-2 text-text">{r.killer}</td>
                <td className="py-1 pr-2 text-dim text-xs">
                  {r.killer_guild || <span className="italic">unguilded</span>}
                </td>
                <td className="py-1 pr-2 text-right text-red-400">{r.killsAgainstWP}</td>
                <td className="py-1 pr-2 text-right text-green">
                  {r.killsByWP > 0 ? r.killsByWP : <span className="text-dim">0</span>}
                </td>
                <td className="py-1 pr-2 text-right text-gold font-semibold">{r.vengeanceOwed}</td>
                <td className="py-1 pr-2 text-right text-dim text-xs">
                  {new Date(r.lastWpVictimAt).toLocaleString(undefined, {
                    year: 'numeric', month: 'short', day: 'numeric',
                    hour: 'numeric', minute: '2-digit',
                  })}
                </td>
                <td className="py-1 pr-2 text-right">
                  <button
                    type="button"
                    onClick={() => copyFor(r)}
                    className={`px-2 py-0.5 rounded text-xs border transition ${
                      wasCopied
                        ? 'border-green text-green bg-green/10'
                        : 'border-border text-text hover:border-blue hover:text-blue'
                    }`}
                    title="Copy the vengeance line for in-game paste"
                  >
                    {wasCopied ? '✓ copied' : '📋 copy'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
