'use client';

// #87 — the interactive half of the officer console.
//
// Follows the /admin/triggers pattern: optimistic useState + useTransition,
// server actions in actions.ts, and NO router.refresh() after a write —
// revalidatePath alone keeps other sessions fresh without re-rendering (and
// visually flashing) the whole page under an officer who is mid-triage.

import { useState, useTransition } from 'react';
import { clearOverride, setOverride, CONFIRM_PHRASES } from './actions';
import type { DriftEntry } from '@/lib/consoleHealth';

type Msg = { ok: boolean; text: string } | null;

export function DriftList({ entries, ages }: { entries: DriftEntry[]; ages: Record<string, number | null> }) {
  const [rows, setRows] = useState(entries);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <p className="text-sm text-green">
        ✅ No control-plane overrides active — everything is at its default.
      </p>
    );
  }

  function onClear(key: string) {
    setRows(r => r.filter(x => x.key !== key));   // optimistic
    startTransition(async () => {
      const res = await clearOverride(key);
      setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (!res.ok) setRows(entries);              // roll back
    });
  }

  return (
    <div className="space-y-3">
      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-green' : 'text-red'}`}>{msg.text}</p>
      )}
      {rows.map(e => {
        const days = ages[e.key];
        const stale = days != null && days >= 7;
        return (
          <div
            key={e.key}
            className={`border rounded p-3 ${e.danger ? 'border-red/50 bg-red/5' : 'border-border'}`}
          >
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <code className="text-sm text-orange">{e.key} = {String(e.value)}</code>
              {e.danger && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red/20 text-red border border-red/40">
                  high blast radius
                </span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                stale ? 'bg-red/20 text-red border-red/40' : 'bg-dim/20 text-dim border-border'
              }`}>
                {days == null
                  ? 'age unknown — set outside the console'
                  : `set ${days === 0 ? 'today' : `${days}d ago`}`}
              </span>
            </div>
            <p className="text-xs text-dim leading-5">{e.meaning}</p>
            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => onClear(e.key)}
                className="px-3 py-1 text-xs rounded bg-orange/80 hover:bg-orange text-bg font-semibold disabled:opacity-50"
              >
                Clear override
              </button>
              {e.runbook && (
                <a href={`#${e.runbook}`} className="text-xs text-blue no-underline hover:underline">
                  read {e.runbook.toUpperCase()} first →
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SHED_STREAMS: { key: string; label: string }[] = [
  { key: 'flag_shed_live_state',      label: 'live-state (buffs / zone)' },
  { key: 'flag_shed_raid_roster',     label: 'raid roster' },
  { key: 'flag_shed_casting',         label: 'cast relay' },
  { key: 'flag_shed_threat_snapshot', label: 'threat snapshot' },
  { key: 'flag_shed_buff_casts',      label: 'buff landings' },
];

export function EmergencyPanel({ active }: { active: Record<string, boolean> }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [confirm, setConfirm] = useState('');
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      setMsg(res.ok ? { ok: true, text: res.message! } : { ok: false, text: res.error! });
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-text mb-1">Shed an ephemeral stream</div>
        <p className="text-xs text-dim leading-5 mb-2">
          200-ack-and-drop at the bot, live in ~60s, reversible. Shed in this order when the
          bot is up but drowning. <b>Never touches parses, chat, boss kills or lockouts</b> —
          the bot refuses to shed those no matter what the flag says.
        </p>
        <div className="flex flex-wrap gap-2">
          {SHED_STREAMS.map(s => (
            <button
              key={s.key}
              type="button"
              disabled={pending || active[s.key]}
              onClick={() => run(() => setOverride(s.key, 1, ''))}
              className="px-3 py-1.5 text-xs rounded border border-border hover:border-red text-text disabled:opacity-40"
            >
              {active[s.key] ? `✓ ${s.label} shed` : `Shed ${s.label}`}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <div className="text-sm font-semibold text-red mb-1">☠ Pause the entire fleet</div>
        <p className="text-xs text-dim leading-5 mb-2">
          Every agent stops uploading and polling. <b>Nothing is lost</b> — durable queues hold,
          heartbeats continue, and each raider&apos;s overlays keep running on their own local data.
          Clearing it resumes the fleet within one heartbeat. But the raid goes blind to everything
          cross-client, so tell them first. Type <code className="text-orange">{CONFIRM_PHRASES.flag_agent_kill}</code> to confirm.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder={CONFIRM_PHRASES.flag_agent_kill}
            className="w-40 bg-bg border border-border rounded px-3 py-1.5 text-sm text-text font-mono"
          />
          <button
            type="button"
            disabled={pending || confirm !== CONFIRM_PHRASES.flag_agent_kill}
            onClick={() => run(() => setOverride('flag_agent_kill', 1, confirm))}
            className="px-3 py-1.5 text-xs rounded bg-red/80 hover:bg-red text-bg font-semibold disabled:opacity-40"
          >
            Pause fleet
          </button>
          {active.flag_agent_kill && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => clearOverride('flag_agent_kill'))}
              className="px-3 py-1.5 text-xs rounded bg-green/80 hover:bg-green text-bg font-semibold disabled:opacity-40"
            >
              Resume fleet
            </button>
          )}
        </div>
      </div>

      {msg && <p className={`text-xs ${msg.ok ? 'text-green' : 'text-red'}`}>{msg.text}</p>}
    </div>
  );
}
