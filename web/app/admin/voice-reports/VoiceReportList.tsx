'use client';

// The /admin/voice-reports table: open reports, newest first. Optimistic local state, no router.refresh() (the
// officer list pattern): a closed report drops out at once and revalidatePath in the action keeps other sessions
// fresh. ▶ speaks suggested_say || spoken with the BROWSER's voice at the stored rate and pitch; Mimic's own
// voice (Kokoro, Piper or the Windows one) sounds different, so this is a guide, not a recording.

import { useState, useTransition } from 'react';
import { closeVoiceReport } from './actions';

export type VoiceReportRow = {
  id: string;
  created_at: string;
  trigger_name: string | null;
  trigger_id: string | null;
  spoken: string;
  original: string | null;
  suggested_say: string | null;
  note: string | null;
  engine: string | null;
  voice: string | null;
  rate: number | null;
  pitch: number | null;
  agent_version: string | null;
  character: string | null;
};

// UTC so the server render and the browser agree.
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  }) + ' UTC';

function speak(r: VoiceReportRow): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  const u = new SpeechSynthesisUtterance(r.suggested_say || r.spoken);
  if (r.rate != null) u.rate = r.rate;
  if (r.pitch != null) u.pitch = r.pitch;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return true;
}

export default function VoiceReportList({ initial }: { initial: VoiceReportRow[] }) {
  const [rows, setRows] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = (id: string, status: 'fixed' | 'dismissed') => {
    setMsg(null);
    startTransition(async () => {
      const r = await closeVoiceReport(id, status);
      if (r.ok) setRows(rs => rs.filter(x => x.id !== id));
      else setMsg(r.error);
    });
  };

  if (rows.length === 0) {
    return <p className="rounded border border-border bg-panel p-4 text-sm text-dim">No open reports. Nothing has been said wrong lately.</p>;
  }

  return (
    <section className="space-y-2">
      {msg && <p role="alert" className="text-sm text-orange">{msg}</p>}
      <div className="overflow-x-auto rounded-lg border border-border bg-panel">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-dim">
            <tr>
              <th className="px-3 py-2 font-normal">When</th>
              <th className="px-3 py-2 font-normal">Trigger</th>
              <th className="px-3 py-2 font-normal">Spoken</th>
              <th className="px-3 py-2 font-normal">Suggested</th>
              <th className="px-3 py-2 font-normal">Voice</th>
              <th className="px-3 py-2 font-normal">Rate / pitch</th>
              <th className="px-3 py-2 font-normal">Reporter</th>
              <th className="px-3 py-2 font-normal"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="whitespace-nowrap px-3 py-2 text-dim">{fmtWhen(r.created_at)}</td>
                <td className="px-3 py-2">{r.trigger_name || r.trigger_id || <span className="text-dim">none</span>}</td>
                <td className="px-3 py-2">
                  {r.spoken}
                  {r.original && r.original !== r.spoken && <div className="text-xs text-dim">written: {r.original}</div>}
                  {r.note && <div className="text-xs text-dim">note: {r.note}</div>}
                </td>
                <td className="px-3 py-2">{r.suggested_say || <span className="text-dim">none</span>}</td>
                <td className="px-3 py-2 text-dim">
                  {[r.engine, r.voice].filter(Boolean).join(' · ') || 'unknown'}
                  {r.agent_version && <div className="text-xs">agent {r.agent_version}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-dim">{r.rate ?? '-'} / {r.pitch ?? '-'}</td>
                <td className="px-3 py-2 text-dim">{r.character || 'unknown'}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <button type="button" onClick={() => { if (!speak(r)) setMsg('This browser cannot speak.'); }}
                    aria-label={`Hear: ${r.suggested_say || r.spoken}`}
                    className="mr-2 rounded border border-border px-2 py-1 text-blue hover:bg-bg">▶</button>
                  <button type="button" disabled={pending} onClick={() => close(r.id, 'fixed')}
                    className="mr-2 rounded border border-border px-2 py-1 text-green hover:bg-bg disabled:opacity-50">Fixed</button>
                  <button type="button" disabled={pending} onClick={() => close(r.id, 'dismissed')}
                    className="rounded border border-border px-2 py-1 text-dim hover:bg-bg disabled:opacity-50">Dismiss</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
