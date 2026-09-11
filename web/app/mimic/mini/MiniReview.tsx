'use client';

// The review shell: one overlay at a time, full mode on the left, the three
// minis on the right with a vote under each, and a feedback thread below that
// persists. One scenario clock drives every mock on screen (10 fps, frozen
// under prefers-reduced-motion). Votes are optimistic: the button flips at
// once and reverts if the server action fails.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { OVERLAYS, CHOICES, tally, type Choice, type FeedbackRow, type VoteRow, type CostLevel, type OverlaySpec, type Member } from '@/lib/miniReview';
import { FullMock, MiniMock, MenuMock, BarRuleMock, Stage, LOOP } from './mocks';
import { castVote, postFeedback } from './actions';

type Me = { id: string; name: string };

const COST_CLS: Record<CostLevel, string> = { low: 'text-green', med: 'text-gold', high: 'text-red' };

function useClock() {
  const [t, setT] = useState(7);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;
    let raf = 0; let last = 0; const start = performance.now();
    const tick = (now: number) => {
      if (now - last >= 100) { last = now; setT(((now - start) / 1000) % LOOP); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return t;
}

function Cost({ o }: { o: OverlaySpec['options'][number] }) {
  const c = o.cost;
  return (
    <div className="grid grid-cols-4 border-t border-border text-[11px]">
      {(['build', 'maint', 'runtime', 'change'] as const).map(kk => (
        <div key={kk} className="px-2 py-1.5 border-r border-border last:border-r-0">
          <div className="text-[9px] uppercase tracking-wider text-dim">{kk}</div>
          <div className={COST_CLS[c[kk]]}>{c[kk]}</div>
        </div>
      ))}
      {c.why && <div className="col-span-4 px-2 pb-1.5 text-[10px] text-dim">{c.why}</div>}
    </div>
  );
}

function When({ iso }: { iso: string }) {
  const [txt, setTxt] = useState('');
  useEffect(() => { setTxt(new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })); }, [iso]);
  return <span suppressHydrationWarning>{txt}</span>;
}

export default function MiniReview({ me, votes: initialVotes, feedback: initialFeedback }: { me: Me; votes: VoteRow[]; feedback: FeedbackRow[] }) {
  const [active, setActive] = useState(OVERLAYS[0].key);
  const [zeal, setZeal] = useState(true);
  const [votes, setVotes] = useState<VoteRow[]>(initialVotes);
  const [feedback, setFeedback] = useState<FeedbackRow[]>(initialFeedback);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'vote' | 'post' | null>(null);
  const [err, setErr] = useState('');
  const t = useClock();
  const topRef = useRef<HTMLDivElement>(null);

  // Deep links: #tank, #ch … — read once on mount, write on change.
  useEffect(() => {
    const h = window.location.hash.replace('#', '');
    if (OVERLAYS.some(o => o.key === h)) setActive(h);
  }, []);
  useEffect(() => { try { history.replaceState(null, '', '#' + active); } catch { /* ignore */ } }, [active]);

  const spec = OVERLAYS.find(o => o.key === active)!;
  const idx = OVERLAYS.indexOf(spec);
  const counts = useMemo(() => tally(votes), [votes]);
  const mine = votes.find(v => v.overlay === active && v.user_id === me.id)?.choice ?? null;
  const myVoteCount = OVERLAYS.filter(o => votes.some(v => v.overlay === o.key && v.user_id === me.id)).length;
  const thread = feedback.filter(f => f.overlay === active);
  const votersFor = (c: Choice) => votes.filter(v => v.overlay === active && v.choice === c).map(v => v.voter_name || 'member');
  const pickOf = (userId: string | null, overlay: string) => (userId ? votes.find(v => v.overlay === overlay && v.user_id === userId)?.choice ?? null : null);
  // Ballot rows: only people who have picked something (Hitya 2026-09-11),
  // you first once you have, the rest by name.
  const ballotRows: Member[] = (() => {
    const byId = new Map<string, string>();
    for (const v of votes) if (!byId.has(v.user_id)) byId.set(v.user_id, v.voter_name || 'member');
    const rows = [...byId.entries()].map(([id, name]) => ({ id, name }));
    return [...rows.filter(r => r.id === me.id), ...rows.filter(r => r.id !== me.id).sort((a, b) => a.name.localeCompare(b.name))];
  })();

  const go = (i: number) => { setActive(OVERLAYS[(i + OVERLAYS.length) % OVERLAYS.length].key); setDraft(''); setErr(''); topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };

  const vote = async (overlay: string, choice: Choice) => {
    if (busy) return;
    const prev = votes;
    setVotes(vs => [...vs.filter(v => !(v.overlay === overlay && v.user_id === me.id)), { overlay, user_id: me.id, choice, voter_name: me.name }]);
    setBusy('vote'); setErr('');
    const r = await castVote({ overlay, choice });
    setBusy(null);
    if (!r.ok) { setVotes(prev); setErr(r.error || 'Vote did not save.'); }
  };

  const post = async () => {
    if (busy) return;
    setBusy('post'); setErr('');
    const r = await postFeedback({ overlay: active, body: draft, choice: mine });
    setBusy(null);
    if (r.ok && r.row) { setFeedback(fs => [...fs, r.row!]); setDraft(''); }
    else setErr(r.error || 'Could not post.');
  };

  return (
    <div className="space-y-6" ref={topRef}>
      <header className="space-y-2">
        <h1 className="text-2xl text-gold">▭ Mimic mini mode — you pick</h1>
        <p className="text-sm text-dim max-w-3xl">
          Every overlay is getting a version that takes less room. For each one: today&apos;s overlay on the left, three
          minis on the right. Vote for the one you&apos;d raid with and say why underneath. Everything animates on the same
          clock — the names and the parse are ours (Kaas Thox, {' '}Sep 10).
        </p>
      </header>

      {/* overlay picker + zeal toggle */}
      <div className="flex flex-wrap items-center gap-2">
        {OVERLAYS.map((o, i) => {
          const voted = votes.some(v => v.overlay === o.key && v.user_id === me.id);
          return (
            <button key={o.key} type="button" onClick={() => go(i)}
              className={['px-2.5 py-1 rounded border text-xs transition-colors',
                o.key === active ? 'bg-accent border-accent text-white' : 'bg-panel border-border text-dim hover:text-text'].join(' ')}>
              {voted ? '✓ ' : ''}{o.title}
            </button>
          );
        })}
        <span className="ml-auto inline-flex rounded border border-border overflow-hidden text-xs">
          <button type="button" onClick={() => setZeal(true)} className={['px-2.5 py-1', zeal ? 'bg-accent text-white' : 'bg-panel text-dim hover:text-text'].join(' ')}>Zeal 1.4.6 + Mimic 2.6.7</button>
          <button type="button" onClick={() => setZeal(false)} className={['px-2.5 py-1', !zeal ? 'bg-accent text-white' : 'bg-panel text-dim hover:text-text'].join(' ')}>older Zeal</button>
        </span>
      </div>

      <details className="bg-panel border border-border rounded-lg">
        <summary className="cursor-pointer px-4 py-2 text-sm text-text">How mini gets switched on (same for every pick)</summary>
        <div className="px-4 pb-4 grid gap-4 md:grid-cols-2 text-sm text-dim">
          <div className="space-y-2">
            <Stage cap="the bar · 4px · percentage on the left"><BarRuleMock t={t} /></Stage>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              <li>4px bar, same green / amber / red thresholds the tank overlay uses (50 / 25).</li>
              <li>✥ and ✕ stay where they are and fade in mini; hover brings them back.</li>
              <li>Names sit right of the bar and ellipsize; the bar gives way, the number never does.</li>
            </ul>
          </div>
          <div className="space-y-2">
            <Stage cap="right-click on ✥ · two new rows"><MenuMock /></Stage>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              <li><kbd className="px-1 border border-border rounded text-text">Ctrl+Shift+M</kbd> minimizes every overlay; press again and everything restores <b className="text-text">except</b> overlays with 📌 on, which keep their mini state.</li>
              <li>The same three controls land on the dashboard&apos;s Overlays tab.</li>
            </ul>
          </div>
        </div>
      </details>

      {/* the active overlay */}
      <section className="space-y-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-lg text-text">{idx + 1}/{OVERLAYS.length} · {spec.title} <span className="text-xs text-dim font-normal">{spec.file}</span></h2>
          <span className="text-xs text-dim">{counts[active].a + counts[active].b + counts[active].c} votes so far</span>
        </div>
        <p className="text-sm text-text/90 border-l-2 border-gold pl-3 max-w-3xl"><span className="text-gold">Hitya&apos;s ask:</span> {spec.ask}</p>
        <p className="text-xs text-dim max-w-3xl"><span className="text-blue">Zeal toggle:</span> {spec.zeal}</p>
        {spec.also && <p className="text-xs text-dim max-w-3xl"><span className="text-purple">Also:</span> {spec.also}</p>}

        <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
          <div className="bg-panel border border-border rounded-lg overflow-hidden self-start">
            <div className="px-3 py-2 border-b border-border text-xs uppercase tracking-wider text-dim">Today · full mode</div>
            <Stage><FullMock overlay={active} t={t} zeal={zeal} /></Stage>
          </div>
          {/* the three minis side by side; descriptions collapsed under each, opened by your pick */}
          <div className="grid gap-3 sm:grid-cols-3 items-start">
            {spec.options.map(o => {
              const n = counts[active][o.key]; const isMine = mine === o.key; const who = votersFor(o.key);
              return (
                <div key={o.key} className={['bg-panel border rounded-lg overflow-hidden flex flex-col', isMine ? 'border-green' : 'border-border'].join(' ')}>
                  <div className="px-3 py-2 border-b border-border flex items-center gap-2 min-w-0">
                    <span className="inline-grid place-items-center w-5 h-5 rounded bg-accent text-white text-[11px] font-bold shrink-0">{o.key.toUpperCase()}</span>
                    <span className="text-sm text-text font-semibold truncate">{o.name}</span>
                  </div>
                  <Stage><MiniMock overlay={active} choice={o.key} t={t} zeal={zeal} /></Stage>
                  <button type="button" onClick={() => vote(active, o.key)} disabled={busy === 'vote'}
                    className={['w-full px-3 py-2 text-sm border-t transition-colors',
                      isMine ? 'bg-green/15 border-green text-green' : 'border-border text-text hover:bg-accent/20'].join(' ')}>
                    {isMine ? '✓ your pick' : 'Pick ' + o.key.toUpperCase()} <span className="text-dim">· {n}</span>
                  </button>
                  <div className="px-3 py-1.5 border-t border-border text-[10px] text-dim leading-snug">{who.length ? who.join(', ') : 'no picks yet'}</div>
                  <details open={isMine} className="border-t border-border">
                    <summary className="cursor-pointer px-3 py-1.5 text-xs text-dim hover:text-text select-none">{isMine ? 'Why this one, and what it costs' : 'What it does, and what it costs'}</summary>
                    <ul className="px-3 pb-2 text-xs text-dim space-y-1 list-disc pl-7">{o.how.map((h, i) => <li key={i}>{h}</li>)}</ul>
                    <Cost o={o} />
                  </details>
                </div>
              );
            })}
          </div>
        </div>

        {/* feedback bar */}
        <div className="bg-panel border border-border rounded-lg p-3 space-y-3">
          <div className="flex flex-wrap gap-2 items-start">
            <textarea id={`fb-${active}`} value={draft} onChange={e => setDraft(e.target.value)} rows={2} maxLength={1000}
              placeholder={`What would make ${spec.title} mini work for you — or what's wrong with all three?`}
              className="flex-1 min-w-[220px] bg-bg border border-border rounded px-3 py-2 text-sm text-text placeholder:text-dim focus:outline-none focus:border-blue" />
            <button type="button" onClick={post} disabled={busy === 'post' || !draft.trim()}
              className="px-4 py-2 rounded bg-accent text-white text-sm disabled:opacity-50">{busy === 'post' ? 'Posting…' : 'Post'}</button>
          </div>
          <div className="text-[11px] text-dim">Posting as <span className="text-text">{me.name}</span>{mine ? <> · your pick is <span className="text-green">{mine.toUpperCase()}</span></> : ' · pick one above and it shows next to your note'}</div>
          {err && <div className="text-xs text-red">{err}</div>}
          {thread.length > 0 && (
            <ul className="space-y-2 border-t border-border pt-3">
              {thread.map(f => (
                <li key={f.id} className="text-sm">
                  <div className="text-[11px] text-dim"><span className="text-text">{f.author}</span>{f.choice && <span className="ml-1 px-1 rounded bg-accent/30 text-white text-[10px]">{f.choice.toUpperCase()}</span>} · <When iso={f.created_at} /></div>
                  <div className="text-text whitespace-pre-wrap">{f.body}</div>
                </li>
              ))}
            </ul>
          )}
          {thread.length === 0 && <div className="text-xs text-dim">No notes on {spec.title} yet.</div>}
        </div>

        <div className="flex items-center justify-between text-sm">
          <button type="button" onClick={() => go(idx - 1)} className="text-blue hover:underline">← {OVERLAYS[(idx + OVERLAYS.length - 1) % OVERLAYS.length].title}</button>
          <span className="text-xs text-dim">you&apos;ve picked {myVoteCount} of {OVERLAYS.length}</span>
          <button type="button" onClick={() => go(idx + 1)} className="text-blue hover:underline">{OVERLAYS[(idx + 1) % OVERLAYS.length].title} →</button>
        </div>
      </section>

      {/* the ballot — one spot per Pack member */}
      <section className="space-y-2">
        <h2 className="text-lg text-text">Who has picked what</h2>
        <p className="text-xs text-dim max-w-3xl">Everyone who has picked something so far. Your row is first once you have, and you can change picks straight from it. A dot is an overlay they have not picked yet.</p>
        <div className="overflow-x-auto border border-border rounded-lg bg-panel">
          <table className="text-xs w-full min-w-[640px]">
            <thead>
              <tr className="text-dim">
                <th className="text-left font-normal px-2 py-1.5">Member</th>
                {OVERLAYS.map((o, i) => <th key={o.key} className="font-normal px-1 py-1.5"><button type="button" onClick={() => go(i)} className="hover:text-text">{o.title}</button></th>)}
                <th className="font-normal px-2 py-1.5">✓</th>
              </tr>
            </thead>
            <tbody>
              {ballotRows.map(m => {
                const isMe = m.id === me.id;
                const n = OVERLAYS.filter(o => pickOf(m.id, o.key)).length;
                return (
                  <tr key={m.id || m.name} className={['border-t border-border/60', isMe ? 'bg-accent/15' : ''].join(' ')}>
                    <td className="px-2 py-1 whitespace-nowrap text-text">{m.name}{isMe ? ' (you)' : ''}</td>
                    {OVERLAYS.map(o => {
                      const v = pickOf(m.id, o.key);
                      return (
                        <td key={o.key} className="px-1 py-1 text-center">
                          {isMe ? (
                            <span className="inline-flex gap-0.5">
                              {CHOICES.map(c => (
                                <button key={c} type="button" onClick={() => vote(o.key, c)} disabled={busy === 'vote'}
                                  className={['w-5 h-5 rounded border text-[10px]', v === c ? 'bg-green/20 border-green text-green' : 'border-border text-dim hover:text-text'].join(' ')}>{c.toUpperCase()}</button>
                              ))}
                            </span>
                          ) : (v ? <span className="text-text">{v.toUpperCase()}</span> : <span className="text-dim">·</span>)}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-center text-dim">{n || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {ballotRows.length === 0 && <div className="px-3 py-3 text-xs text-dim">Nobody has picked yet — be the first.</div>}
        </div>
      </section>

      <p className="text-[11px] text-dim">
        Picks can be changed any time. Not on Zeal 1.4.6 yet? <Link href="/zeal-spawn-id.png" className="text-blue hover:underline">Here is why it matters</Link>.
        {' '}Something else broken or wanted? <Link href="/feedback" className="text-blue hover:underline">/feedback</Link>.
      </p>
    </div>
  );
}
