'use client';

// Account inventory, built on this PC. The rows come from the agent on the same origin
// (GET /api/local/inventory, which reads the <Char>-Inventory.txt files EQ wrote) and go through the SAME
// aggregation and the SAME explorer as the website's /me/inventory. Nothing is uploaded anywhere.
//
// Game accounts: when you are signed in to Mimic the agent also hands over YOUR placements (which character is
// on which game account, the list you keep on wolfpack.quest /me/accounts), the same input the website uses, so
// both pages agree. The switch "Use my account list from wolfpack.quest" turns that off (the agent then never
// asks) and the page guesses accounts from the shared-bank files.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import InventoryExplorer from '@/app/me/inventory/InventoryExplorer';
import { aggregateInventory, type InvRow, type ItemMeta } from '@/lib/inventoryAggregate';
import type { AccountPlacement } from '@/lib/sharedBank';
import { classifyCharacters, dropCharacters } from '@/lib/localAccounts';

type LocalInventoryResponse = {
  ok: boolean;
  characters: { name: string; observed_at: string | null; rows: number; log_first_at?: string | null; log_last_at?: string | null }[];
  rows: InvRow[];
  /** Item facts for the type chips. Empty until the agent has a catalog that carries them. */
  meta: ItemMeta[];
  /** The signed-in person's own account placements; empty when off, signed out, offline or none set. */
  placements?: AccountPlacement[];
  placements_source?: 'site' | 'off' | 'none';
  placements_reason?: string | null;
  use_account_list?: boolean;
};

const HIDE_ONE_OFF_KEY = 'wp-local-inventory-hide-one-off';
const readHideOneOff = () => { try { return localStorage.getItem(HIDE_ONE_OFF_KEY) === '1'; } catch { return false; } };

// Why there are no placements, in words for a raider. Null = nothing to explain.
function whyNoList(source: string | undefined, reason: string | null | undefined): string | null {
  if (source === 'off') return null;
  if (source === 'site' && !reason) return null;
  switch (reason) {
    case 'signed-out': return 'Sign in to Mimic to use your account list from wolfpack.quest.';
    case 'local':      return 'Mimic is in local-only mode, so your account list from wolfpack.quest is not available.';
    case 'bot-old':    return 'The guild server has not been updated to hand out account lists yet.';
    case 'offline':    return source === 'site' ? 'Could not reach wolfpack.quest just now; showing the list from earlier.' : 'Could not reach wolfpack.quest just now.';
    default:           return null;
  }
}

export default function LocalInventory() {
  const [data, setData] = useState<LocalInventoryResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hideOneOff, setHideOneOff] = useState(false);

  const load = useCallback((refresh = false) => {
    fetch('/api/local/inventory' + (refresh ? '?refresh=1' : ''), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`the agent answered ${r.status}`))))
      .then((j: LocalInventoryResponse) => { setData(j); setErr(null); })
      .catch((e: Error) => setErr(e.message || 'could not reach the agent'));
  }, []);

  // Load once, and again whenever the window regains focus: you run /outputfile inventory in game, tab
  // back, and the list is current without a reload.
  useEffect(() => {
    setHideOneOff(readHideOneOff());
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const setUseList = useCallback((use: boolean) => {
    fetch('/api/local/account-list', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ use }),
    }).then(() => load(true)).catch(() => load());
  }, [load]);

  const toggleHideOneOff = useCallback(() => {
    setHideOneOff(v => {
      try { localStorage.setItem(HIDE_ONE_OFF_KEY, v ? '0' : '1'); } catch { /* private window: the choice just is not remembered */ }
      return !v;
    });
  }, []);

  const verdicts = useMemo(() => (data ? classifyCharacters(data.characters, Date.now()) : null), [data]);

  const agg = useMemo(() => {
    if (!data || !verdicts) return null;
    // One-off characters count in every total unless hidden; hiding drops their own gear, bags and bank.
    const rows = hideOneOff ? dropCharacters(data.rows, verdicts.oneOff) : data.rows;
    return aggregateInventory(rows, data.placements ?? [], new Map(data.meta.map(m => [m.id, m])), verdicts.stale);
  }, [data, verdicts, hideOneOff]);

  const oneOffNames = useMemo(
    () => (data && verdicts ? data.characters.filter(c => verdicts.oneOff.has(c.name.toLowerCase())).map(c => c.name) : []),
    [data, verdicts]);
  const staleNames = useMemo(
    () => (data && verdicts ? data.characters.filter(c => verdicts.stale.has(c.name.toLowerCase())).map(c => c.name) : []),
    [data, verdicts]);

  const useList = data?.use_account_list !== false;
  const placed = data?.placements_source === 'site' && (data.placements?.length ?? 0) > 0;
  const noListWhy = data ? whyNoList(data.placements_source, data.placements_reason) : null;

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-start gap-3">
          <h2 className="text-2xl text-gold mb-1"><span aria-hidden>🎒 </span>My account inventory</h2>
          <button type="button" onClick={() => load(true)}
            className="ml-auto text-[11px] px-2 py-0.5 rounded border border-border text-dim hover:text-text">
            Reload
          </button>
        </div>
        <div className="text-sm text-dim leading-6">
          Everything across <b className="text-text">all your characters</b> at once, with the total of each item and
          exactly who is holding it. Items in the <b className="text-purple">shared bank</b> are tagged and count{' '}
          <b className="text-text">once per game account</b>. Data comes from the{' '}
          <code>/outputfile inventory</code> files on this PC.{' '}
          To turn a character&apos;s inventory sync or hiding on or off, see{' '}
          <Link href="/me/#characters" className="text-blue hover:underline">/me</Link>.
        </div>
        {data && agg && (
          <div className="mt-3 text-xs text-dim flex flex-wrap gap-x-6 gap-y-1">
            <span>Characters: <span className="text-text">{data.characters.length}</span></span>
            <span>Inventory rows: <span className="text-text">{data.rows.length.toLocaleString()}</span></span>
            <span>Distinct items: <span className="text-text">{agg.items.length.toLocaleString()}</span></span>
            {agg.sharedAccountCount > 0 && (
              <span title="Accounts whose shared bank was read, and the characters it was read from">
                Shared banks: <span className="text-text">{agg.sharedAccountCount} account{agg.sharedAccountCount === 1 ? '' : 's'} ({agg.sharedCharacterCount} character{agg.sharedCharacterCount === 1 ? '' : 's'})</span>
                {' '}<span className="opacity-70">{placed ? '· from your account list' : '· guessed from the shared banks'}</span>
              </span>
            )}
          </div>
        )}
        {data && (
          <div className="mt-3 text-xs text-dim space-y-1">
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <input type="checkbox" checked={useList} onChange={e => setUseList(e.target.checked)} />
              <span>Use my account list from wolfpack.quest</span>
            </label>
            <div className="leading-5">
              {useList
                ? 'Mimic asks wolfpack.quest which of your characters are on which game account (the list on /me/accounts) so each shared bank counts once per real account. Nothing from this PC is uploaded.'
                : 'Off: Mimic does not ask wolfpack.quest anything and guesses your accounts from the shared-bank files, which can split or merge accounts wrongly.'}
              {noListWhy && <span className="text-orange"> {noListWhy}</span>}
            </div>
          </div>
        )}
      </section>

      {data && agg && (oneOffNames.length > 0 || staleNames.length > 0) && (
        <section className="bg-panel border border-border rounded-lg p-4 space-y-3 text-xs text-dim leading-5">
          {oneOffNames.length > 0 && (
            <div className="space-y-1">
              <button type="button" aria-pressed={hideOneOff} onClick={toggleHideOneOff}
                className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${hideOneOff ? 'border-gold text-gold' : 'border-border text-dim hover:text-text'}`}>
                Hide one-off characters ({oneOffNames.length})
              </button>
              <div>
                Made for one thing, played under a day in total, and not seen for 30+ days: {oneOffNames.join(', ')}.{' '}
                {hideOneOff
                  ? 'Hidden: their own gear, bags and bank are left out of every total below. The shared bank still counts, because the other characters on the account use it.'
                  : 'Shown: they count in every total below.'}
              </div>
            </div>
          )}
          {staleNames.length > 0 && (
            <div>
              <span className="text-orange">⏳ May be out of date ({staleNames.length}):</span> {staleNames.join(', ')}. These
              were played after their inventory file was last written (a quit that did not finish, a lost connection, a
              freeze, or just playing since). Run <code className="text-text">/outputfile inventory</code> on them to refresh.
              {agg.staleSharedSources.length > 0 && (
                <> A shared bank is being read from {agg.staleSharedSources.join(', ')}, the newest snapshot there is for its account.</>
              )}
            </div>
          )}
        </section>
      )}

      {err && !data ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          Could not read your inventory from Mimic ({err}). Open this page from Mimic&apos;s dashboard, with the agent running.
        </section>
      ) : !data || !agg ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">Reading your inventory files…</section>
      ) : agg.items.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No inventory files found yet. In EQ run <code className="text-text">/outputfile inventory</code> on each
          character; the <code className="text-text">&lt;Char&gt;-Inventory.txt</code> file it writes lands in your EverQuest
          folder and shows up here.
        </section>
      ) : (
        <InventoryExplorer
          items={agg.items}
          characters={data.characters
            .filter(c => !(hideOneOff && verdicts?.oneOff.has(c.name.toLowerCase())))
            .map(c => ({ name: c.name, cls: null, active: true, stale: !!verdicts?.stale.has(c.name.toLowerCase()) }))}
        />
      )}
    </div>
  );
}
