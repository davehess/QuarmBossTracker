'use client';

// The officer form for one event's Soft Reserve rules. The server action checks everything again; this only
// collects the fields and shows what came back.
import { useState, useTransition } from 'react';
import { LOCK_LABEL, LOCK_MODES, VISIBILITIES, VISIBILITY_LABEL, type SrRules } from '@/lib/softReserve';
import { saveSrRules, setSrLocked } from './actions';

type PlanBoss = { npc: number; name: string; zone: string };

// A datetime-local input wants "YYYY-MM-DDTHH:mm" in the viewer's own time.
const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function RulesForm({ eventId, rules, planBosses }: { eventId: string; rules: SrRules; planBosses: PlanBoss[] }) {
  const planIds = new Set(planBosses.map(b => b.npc));
  const [enabled, setEnabled] = useState(rules.enabled);
  const [perPerson, setPerPerson] = useState(String(rules.per_person));
  const [perBoss, setPerBoss] = useState(rules.per_boss == null ? '' : String(rules.per_boss));
  const [visibility, setVisibility] = useState<string>(rules.visibility);
  const [lockMode, setLockMode] = useState<string>(rules.lock_mode);
  const [lockAt, setLockAt] = useState(toLocalInput(rules.lock_at));
  const [noReserve, setNoReserve] = useState<string>(rules.no_reserve);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(rules.npc_ids.filter(n => planIds.has(n))));
  const [others, setOthers] = useState(rules.npc_ids.filter(n => !planIds.has(n)).join(', '));
  const [locked, setLocked] = useState(rules.locked);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toggle = (n: number) => setPicked(prev => { const s = new Set(prev); if (s.has(n)) s.delete(n); else s.add(n); return s; });

  function save() {
    const extra = others.split(/[\s,]+/).filter(Boolean).map(Number);
    if (extra.some(n => !Number.isInteger(n) || n <= 0)) { setMsg({ ok: false, text: 'Other bosses must be PQDI NPC numbers, separated by commas.' }); return; }
    // The server runs in UTC; send the lock time as an exact instant, read here in the officer's own time.
    const at = lockAt ? new Date(lockAt) : null;
    const lockIso = at && !Number.isNaN(at.getTime()) ? at.toISOString() : '';
    start(async () => {
      const res = await saveSrRules(eventId, {
        enabled, per_person: perPerson, per_boss: perBoss, visibility, npc_ids: [...picked, ...extra],
        lock_mode: lockMode, lock_at: lockIso, no_reserve: noReserve,
      });
      setMsg({ ok: res.ok, text: res.message });
    });
  }

  function flipLock() {
    start(async () => {
      const res = await setSrLocked(eventId, !locked);
      if (res.ok) setLocked(!locked);
      setMsg({ ok: res.ok, text: res.message });
    });
  }

  const field = 'mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-sm text-text';
  return (
    <div className="space-y-4 text-sm">
      <label className="flex items-center gap-2 text-text">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        Soft Reserve is on for this raid
      </label>

      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wider text-dim">Bosses it covers</legend>
        <p className="text-xs text-dim">
          Raid-Helper&apos;s text for the event has no target list, so the officers pick. Nothing picked on the plan night falls back to the raid night plan.
        </p>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {planBosses.map(b => (
            <label key={b.npc} className="flex items-center gap-2 text-text">
              <input type="checkbox" checked={picked.has(b.npc)} onChange={() => toggle(b.npc)} />
              {b.name} <span className="text-xs text-dim">· {b.zone}</span>
            </label>
          ))}
        </div>
        <label className="mt-2 block text-xs text-dim">
          Other bosses, by PQDI NPC number (for example 200226, 221041)
          <input className={field} value={others} onChange={e => setOthers(e.target.value)} inputMode="numeric" />
        </label>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-dim">
          Picks per person (0 to 20)
          <input className={field} value={perPerson} onChange={e => setPerPerson(e.target.value)} inputMode="numeric" />
        </label>
        <label className="text-xs text-dim">
          Picks per boss (blank = no limit)
          <input className={field} value={perBoss} onChange={e => setPerBoss(e.target.value)} inputMode="numeric" />
        </label>
        <label className="text-xs text-dim">
          Who sees the names
          <select className={field} value={visibility} onChange={e => setVisibility(e.target.value)}>
            {VISIBILITIES.map(v => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
          </select>
        </label>
        <label className="text-xs text-dim">
          Picks lock
          <select className={field} value={lockMode} onChange={e => setLockMode(e.target.value)}>
            {LOCK_MODES.map(m => <option key={m} value={m}>{LOCK_LABEL[m]}</option>)}
          </select>
        </label>
        {lockMode === 'time' && (
          <label className="text-xs text-dim">
            Lock at (your time)
            <input className={field} type="datetime-local" value={lockAt} onChange={e => setLockAt(e.target.value)} />
          </label>
        )}
        <label className="text-xs text-dim">
          An item nobody reserved
          <select className={field} value={noReserve} onChange={e => setNoReserve(e.target.value)}>
            <option value="open">Open to the whole raid</option>
            <option value="officer">An officer decides</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={pending}
          className="min-h-[40px] rounded border border-gold bg-gold/10 px-4 text-gold disabled:opacity-50">Save</button>
        <button type="button" onClick={flipLock} disabled={pending}
          className="min-h-[40px] rounded border border-border px-4 text-text disabled:opacity-50">
          {locked ? 'Unlock picks' : 'Lock picks now'}
        </button>
        {msg && <span role="status" className={msg.ok ? 'text-green' : 'text-red'}>{msg.text}</span>}
      </div>
    </div>
  );
}
