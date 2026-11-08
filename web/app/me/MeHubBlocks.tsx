// The data-backed blocks of the /me?v=b hub. Each is its own async server component with its own read (lib/meHubLoad.ts)
// and sits behind its own <Suspense> in MeHub.tsx, so the page shows at once and each block fills in when ITS read
// returns; a slow one holds nothing else. Every block keeps a minimum height equal to its skeleton's (SLOT), so the
// fill-in does not move what is below it. A block whose read fails says so in place and leaves the rest standing.
import Link from 'next/link';
import UploadFreshness from '@/components/UploadFreshness';
import { userTz } from '@/lib/timezone';
import { relTime, fmtAbs } from '@/lib/timezone-shared';
import { loadUploadStampRow, uploadStampsFor } from '@/lib/uploadFreshnessServer';
import {
  loadHubChars, loadHubHeartbeats, loadHubMain, loadHubPack, loadMainStats, loadMainZone, loadToggleFlags,
  loadMainFights, loadMainLoot, loadMainRaids,
} from '@/lib/meHubLoad';
import { characterLinks, mimicStatus, isRoot, syncStatus, replayHref, type HubChar } from '@/lib/meHub';
import { fmtDkp, cleanBossName } from '@/lib/format';
import { nightLabel } from '@/lib/raidHeatmap';
import type { ParseFight } from '@/lib/parseTrend';
import ExclusionToggles from './ExclusionToggles';
import MeHubUploads from './MeHubUploads';

// Heights of each block's slot (skeleton and filled block alike).
export const SLOT = {
  identity: '7rem',
  fresh: '1.5rem',
  record: '17rem',
  best: '16rem',
  loot: '16rem',
  raids: '14rem',
  uploads: '7rem',
  mimic: '5rem',
  discord: '2rem',
  alts: '9rem',
  chars: '12rem',
} as const;

export function Skeleton({ h }: { h: string }) {
  return (
    <div role="status" className="rounded border border-border/60 bg-panel motion-safe:animate-pulse" style={{ minHeight: h }}>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function Failed({ h, what }: { h: string; what: string }) {
  return (
    <div className="rounded border border-orange/40 bg-bg p-3 text-xs text-dim" style={{ minHeight: h }}>
      Couldn&apos;t load {what} just now. Refresh to try again.
    </div>
  );
}

const chip = 'inline-flex min-h-[40px] items-center rounded border border-border bg-bg px-3 text-sm text-blue hover:underline';

function fmtDmg(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return String(n);
}

// ── Section 1: your main ────────────────────────────────────────────────────────────────────────────────────

export async function MainIdentity({ userId }: { userId: string }) {
  const main = await loadHubMain(userId).catch(() => undefined);
  if (main === undefined) return <Failed h={SLOT.identity} what="your characters" />;
  if (main === null) {
    return (
      <div style={{ minHeight: SLOT.identity }} className="rounded border border-orange/40 bg-bg p-3 text-sm">
        <div className="text-orange">No characters linked to your Discord account yet.</div>
        <p className="mt-1 text-xs text-dim">
          They appear once Mimic sees them in your EverQuest logs, or once an officer links them.{' '}
          <Link href="/start" className="text-blue hover:underline">Getting started →</Link>
        </p>
      </div>
    );
  }
  const { char: c, explicit } = main;
  return (
    <div style={{ minHeight: SLOT.identity }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-xl text-text">{c.name}</h3>
        {c.level != null && <span className="text-sm text-gold">L{c.level}</span>}
        <span className="text-xs text-dim">{[c.class, c.rank].filter(Boolean).join(' · ') || '—'}</span>
        {!c.active && <span className="text-xs text-dim">(inactive)</span>}
      </div>
      {!explicit && (
        <p className="mt-1 text-xs text-dim">
          We can&apos;t tell which character is your main, so this is the one we heard from most recently. Your main is the
          character OpenDKP files your others under; ask an officer to link them there.
        </p>
      )}
      <nav aria-label={`${c.name}'s pages`} className="mt-3 flex flex-wrap gap-2">
        {characterLinks(c.name).map(l => <Link key={l.key} href={l.href} className={chip}>{l.label}</Link>)}
        <Link href="/pop/raid/me" className={chip}>PoP flags for tonight</Link>
      </nav>
    </div>
  );
}

// When the main's gear, inventory and spellbook last arrived. The inventory and spells times are left out for a
// character whose inventory sync the member switched off, the same as the gear page withholds them from a viewer who
// may not open those pages.
export async function MainFreshness({ userId }: { userId: string }) {
  const main = await loadHubMain(userId).catch(() => null);
  if (!main) return <div style={{ minHeight: SLOT.fresh }} />;
  const c = main.char;
  const row = await loadUploadStampRow(c.name).catch(() => null);
  const [gear, inventory, spells] = await Promise.all([
    uploadStampsFor('gear', c.name, row, null),
    c.excludeInventory ? Promise.resolve(undefined) : uploadStampsFor('inventory', c.name, row),
    c.excludeInventory ? Promise.resolve(undefined) : uploadStampsFor('spells', c.name, row),
  ]).catch(() => [undefined, undefined, undefined] as const);
  return (
    <div style={{ minHeight: SLOT.fresh }}>
      <UploadFreshness gear={gear} inventory={inventory} spells={spells} />
    </div>
  );
}

// The classic card's Parses numbers, its latest fights and where the character was last seen.
export async function MainRecord({ userId }: { userId: string }) {
  const main = await loadHubMain(userId).catch(() => null);
  if (!main) return <div style={{ minHeight: SLOT.record }} />;
  const name = main.char.name;
  const [stats, zone, tz] = await Promise.all([
    loadMainStats(name).catch(() => null),
    loadMainZone(name).catch(() => null),
    userTz(),
  ]);
  if (!stats) return <Failed h={SLOT.record} what="your parses" />;
  const a = stats.agg;
  const cells: { label: string; value: string; href?: string }[] = [
    { label: 'Encounters', value: (a?.encounter_count ?? 0).toLocaleString() },
    { label: 'Total damage', value: fmtDmg(a?.total_damage ?? 0) },
    { label: 'Top fight', value: a && a.top_damage > 0 ? fmtDmg(a.top_damage) : '—', href: a && a.top_damage > 0 && a.top_encounter_id ? `/parses/${a.top_encounter_id}` : undefined },
    { label: 'Last upload', value: a?.last_upload ? relTime(a.last_upload) : '—' },
  ];
  return (
    <div style={{ minHeight: SLOT.record }}>
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        {cells.map(x => (
          <div key={x.label} className="rounded border border-border bg-bg p-3">
            <div className="text-xl text-text">{x.value}</div>
            <div className="text-dim">{x.href ? <Link href={x.href} className="text-blue hover:underline">{x.label} →</Link> : x.label}</div>
          </div>
        ))}
      </div>
      <h3 className="mb-1 mt-4 text-xs text-orange">Recent parses</h3>
      {stats.recent.length === 0 ? (
        <p className="text-xs italic text-dim">No parses recorded.</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {stats.recent.map(e => (
            <li key={e.id} className="flex items-center gap-2">
              <Link href={`/parses/${e.id}`} className="min-w-0 flex-1 truncate text-blue hover:underline">{e.npc || 'unknown'}</Link>
              <span className="hidden shrink-0 whitespace-nowrap text-[10px] tabular-nums text-dim sm:inline">{fmtAbs(e.startedAt, tz)}</span>
              <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-text">{e.damage.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-dim">
        <Link href="/me/parses" className="text-blue hover:underline">All your parses →</Link>
        {zone?.zone && <span className="ml-3">Last seen in <span className="text-text">{zone.zone}</span>{zone.updatedAt && <> · {relTime(zone.updatedAt)}</>}</span>}
      </p>
    </div>
  );
}

function FightList({ title, fights, figure }: { title: string; fights: ParseFight[]; figure: (f: ParseFight) => string }) {
  return (
    <div>
      <h4 className="mb-1 text-[11px] text-dim">{title}</h4>
      {fights.length === 0 ? (
        <p className="text-xs italic text-dim">No boss fights recorded.</p>
      ) : (
        <ol className="space-y-1 text-xs">
          {fights.map((f, i) => (
            <li key={f.eid} className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-right text-[10px] text-dim">{i + 1}</span>
              <Link href={`/parses/${f.eid}`} className="min-w-0 flex-1 truncate text-blue hover:underline">{cleanBossName(f.name)}</Link>
              <span className="shrink-0 whitespace-nowrap text-[10px] tabular-nums text-text">{figure(f)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// The main's best boss fights, by damage and by DPS. Each is a link to its parse page.
export async function MainBest({ userId }: { userId: string }) {
  const main = await loadHubMain(userId).catch(() => null);
  if (!main) return <div style={{ minHeight: SLOT.best }} />;
  const fights = await loadMainFights(userId, main.char.name).catch(() => null);
  if (!fights) return <Failed h={SLOT.best} what="your best fights" />;
  return (
    <div style={{ minHeight: SLOT.best }} className="rounded border border-border bg-bg p-3">
      <h3 className="mb-2 text-xs text-orange">Best fights</h3>
      <div className="space-y-3">
        <FightList title="Highest damage" fights={fights.byDamage} figure={f => f.dmg.toLocaleString()} />
        <FightList title="Highest DPS" fights={fights.byDps} figure={f => `${Math.round(f.dps).toLocaleString()} dps`} />
      </div>
      <p className="mt-2 text-[10px] text-dim">
        {fights.truncated ? `From your newest ${fights.considered} boss fights.` : `From your ${fights.considered} boss fights since parses became comparable.`}
      </p>
    </div>
  );
}

// The main's newest loot and the DKP spent. The OpenDKP mirror holds what was spent, not the live balance: the balance
// is OpenDKP's own number (Mimic's loot panel reads it live), so this block does not guess one.
export async function MainLoot({ userId }: { userId: string }) {
  const main = await loadHubMain(userId).catch(() => null);
  if (!main) return <div style={{ minHeight: SLOT.loot }} />;
  const loot = await loadMainLoot(userId, main.char.name).catch(() => null);
  if (!loot) return <Failed h={SLOT.loot} what="your loot" />;
  return (
    <div style={{ minHeight: SLOT.loot }} className="rounded border border-border bg-bg p-3">
      <h3 className="mb-2 text-xs text-orange">Latest loot and DKP</h3>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-border/60 p-2">
          <div className="text-lg text-gold">{fmtDkp(loot.allSpent)}</div>
          <div className="text-dim">DKP spent, all your characters · {loot.allItems} items</div>
        </div>
        <div className="rounded border border-border/60 p-2">
          <div className="text-lg text-text">{fmtDkp(loot.mainSpent)}</div>
          <div className="text-dim">on {main.char.name} · {loot.mainItems} items</div>
        </div>
      </div>
      {loot.latest.length === 0 ? (
        <p className="mt-2 text-xs italic text-dim">No loot won yet.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs">
          {loot.latest.map((l, i) => (
            <li key={`${l.raid_date}-${l.item_name}-${i}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-text">{l.item_name || 'unknown item'}</span>
              <span className="hidden shrink-0 text-[10px] text-dim sm:inline">{l.raid_date ? nightLabel(String(l.raid_date).slice(0, 10)) : ''}</span>
              <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-gold">{fmtDkp(l.dkp)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-dim">
        Your live balance is OpenDKP&apos;s own number: it is on the loot panel in Mimic, and on the OpenDKP site.
      </p>
    </div>
  );
}

// The raid nights the main was ticked into, each with a link to that night's replay with the main followed (and so
// highlighted). A night nobody recorded has no replay to link.
export async function MainRaids({ userId }: { userId: string }) {
  const main = await loadHubMain(userId).catch(() => null);
  if (!main) return <div style={{ minHeight: SLOT.raids }} />;
  const name = main.char.name;
  const raids = await loadMainRaids(name).catch(() => null);
  if (!raids) return <Failed h={SLOT.raids} what="your raids" />;
  return (
    <div style={{ minHeight: SLOT.raids }} className="rounded border border-border bg-bg p-3">
      <h3 className="mb-2 text-xs text-orange">Raids {name} was in</h3>
      {raids.length === 0 ? (
        <p className="text-xs italic text-dim">No raid nights with {name} in the last 45 days.</p>
      ) : (
        <ul className="space-y-2 text-xs">
          {raids.map(r => (
            <li key={r.date} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-28 shrink-0 text-text">{nightLabel(r.date)}</span>
              <span className="min-w-0 flex-1 truncate text-dim">{r.names.join(' · ') || '(unnamed)'} · {r.ticks} {r.ticks === 1 ? 'tick' : 'ticks'}</span>
              <span className="flex shrink-0 gap-3">
                {r.from != null && r.to != null
                  ? <Link href={replayHref(r.from, r.to, name)} className="py-1 text-blue hover:underline">Replay with you highlighted →</Link>
                  : <span className="py-1 text-dim">no recording</span>}
                <Link href={`/raid/review/${r.date}`} className="py-1 text-blue hover:underline">Night review →</Link>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-dim">
        Nights OpenDKP ticked {name} into. <Link href="/me" className="text-blue hover:underline">The classic view</Link> has the 60-day attendance grid for all your characters.
      </p>
    </div>
  );
}

// A spot to hand over files by hand: the same inventory, keys and spellbook uploads the classic cards carry, for the
// main or another character. Mimic sends these on its own, so this is the fallback.
export async function MainUploads({ userId }: { userId: string }) {
  const chars = await loadHubChars(userId).catch(() => null);
  if (!chars) return <Failed h={SLOT.uploads} what="your characters" />;
  const main = await loadHubMain(userId).catch(() => null);
  const pickable = chars.filter(c => !c.excludeStats).map(c => ({ name: c.name, excludeInventory: c.excludeInventory }));
  return (
    <div style={{ minHeight: SLOT.uploads }} className="rounded border border-border bg-bg p-3">
      <h3 className="mb-1 text-xs text-orange">Upload your files</h3>
      <p className="mb-2 text-xs text-dim">Mimic uploads these for you; use this only if it cannot reach a character.</p>
      {pickable.length === 0
        ? <p className="text-xs italic text-dim">No characters to upload for yet.</p>
        : <MeHubUploads chars={pickable} initial={main?.char.name ?? pickable[0].name} />}
    </div>
  );
}

// ── Section 2: your account ─────────────────────────────────────────────────────────────────────────────────

export async function AccountMimic({ userId }: { userId: string }) {
  const [chars, beats] = await Promise.all([
    loadHubChars(userId).catch(() => null),
    loadHubHeartbeats(userId).catch(() => null),
  ]);
  if (!chars || !beats) return <Failed h={SLOT.mimic} what="Mimic's status" />;
  const b = mimicStatus(
    chars.map(c => ({ name: c.name, lastSeen: beats.get(c.name.toLowerCase())?.lastSeen ?? null, lastFight: beats.get(c.name.toLowerCase())?.lastFight ?? null })),
    Date.now(), relTime,
  );
  const border = b.color === 'green' ? 'border-green/60' : b.color === 'orange' ? 'border-orange/60' : b.color === 'red' ? 'border-red/60' : 'border-border';
  const text = b.color === 'green' ? 'text-green' : b.color === 'orange' ? 'text-orange' : b.color === 'red' ? 'text-red-400' : 'text-dim';
  return (
    <div style={{ minHeight: SLOT.mimic }} className={`rounded-lg border bg-bg p-3 ${border}`}>
      <div className={`text-sm font-semibold ${text}`}>{b.headline}</div>
      <div className="mt-0.5 text-xs text-dim">{b.sub}</div>
    </div>
  );
}

export async function AccountDiscord({ userId }: { userId: string }) {
  const pack = await loadHubPack(userId).catch(() => undefined);
  return (
    <p style={{ minHeight: SLOT.discord }} className="text-sm text-dim">
      {pack === undefined ? 'Your Discord link could not be read just now.'
        : pack === null ? 'This sign-in is not linked to a guild member yet. Sign out and in again with the Discord account you use in the server.'
        : <>Signed in with Discord as <span className="text-text">{pack.nickname || pack.discordId}</span>.</>}
    </p>
  );
}

function CharRow({ c, seen }: { c: HubChar; seen: string | null }) {
  const status = syncStatus(seen, Date.now());
  return (
    <li className="flex items-center justify-between gap-2 rounded border border-border/60 bg-bg px-2 py-1.5 text-xs">
      <span className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className={status === 'live' ? 'text-green' : status === 'never' ? 'text-dim/60' : 'text-orange'}>●</span>
        <Link href={`/character/${encodeURIComponent(c.name)}`} className="truncate text-text hover:underline">{c.name}</Link>
        <span className="shrink-0 text-dim">{[c.level != null ? `L${c.level}` : null, c.class].filter(Boolean).join(' ')}</span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-[10px] text-dim">{seen ? relTime(seen) : 'no uploads'}</span>
    </li>
  );
}

// The member's other characters, compact, and the per-character privacy switches (the same ExclusionToggles the
// classic card header carries, so a switch here is the same switch).
export async function AccountCharacters({ userId }: { userId: string }) {
  const [chars, beats, main] = await Promise.all([
    loadHubChars(userId).catch(() => null),
    loadHubHeartbeats(userId).catch(() => new Map()),
    loadHubMain(userId).catch(() => null),
  ]);
  if (!chars) return <Failed h={SLOT.alts} what="your characters" />;
  const flags = await loadToggleFlags(chars.map(c => c.name)).catch(() => new Map());
  const seen = (c: HubChar): string | null => beats.get(c.name.toLowerCase())?.lastSeen ?? null;
  const others = chars.filter(c => !c.excludeStats && c.name !== main?.char.name);
  const front = others.filter(c => c.tier !== 'hidden' && !c.hidden);
  const tucked = others.filter(c => !front.includes(c));
  const excluded = chars.filter(c => c.excludeStats);
  const switchRow = (c: HubChar) => {
    const f = flags.get(c.name.toLowerCase());
    return (
      <li key={c.name} className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-text">{c.name}{isRoot(c) ? '' : <span className="text-dim"> · alt</span>}{c.excludeStats && <span className="text-orange"> · excluded from stats</span>}</span>
        <ExclusionToggles
          character={c.name}
          excludeFromStats={c.excludeStats}
          excludeInventory={c.excludeInventory}
          tellRelay={!!f?.tell_relay}
          tellDm={f?.tell_dm !== false}
          showInventoryPublicly={!!f?.show_inventory_publicly}
          showQuestsPublicly={!!f?.show_quests_publicly}
          hiddenFromLists={c.hidden}
        />
      </li>
    );
  };
  return (
    <div style={{ minHeight: SLOT.alts }}>
      <h3 className="mb-1 text-xs text-orange">Your other characters</h3>
      {front.length === 0 ? (
        <p className="text-xs italic text-dim">No other characters up front.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">{front.map(c => <CharRow key={c.name} c={c} seen={seen(c)} />)}</ul>
      )}
      {tucked.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer select-none text-dim hover:text-text">
            {tucked.length} more · traders, bank mules, under level 46, no known level or hidden by you
          </summary>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{tucked.map(c => <CharRow key={c.name} c={c} seen={seen(c)} />)}</ul>
        </details>
      )}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer select-none text-dim hover:text-text">
          Privacy switches for all {chars.length} characters{excluded.length > 0 && ` (${excluded.length} excluded from stats)`}
        </summary>
        <p className="mt-2 text-dim">
          Per character: whether Mimic uploads its inventory, who can open its inventory and quest pages, whether it
          shows in lists, and whether it is left out of stats entirely.
        </p>
        <ul className="mt-2 space-y-2">{chars.map(switchRow)}</ul>
      </details>
    </div>
  );
}

// ── Section 3: all your stuff ───────────────────────────────────────────────────────────────────────────────

export async function DirectoryCharacters({ userId }: { userId: string }) {
  const chars = await loadHubChars(userId).catch(() => null);
  if (!chars) return <Failed h={SLOT.chars} what="your characters" />;
  const shown = chars.filter(c => !c.excludeStats);
  const front = shown.filter(c => c.tier !== 'hidden' && !c.hidden);
  const rest = shown.filter(c => !front.includes(c));
  const card = (c: HubChar) => (
    <li key={c.name} className="rounded border border-border bg-bg p-3">
      <div className="mb-1 text-sm text-text">{c.name}{c.level != null && <span className="ml-2 text-xs text-gold">L{c.level}</span>}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {characterLinks(c.name).map(l => <Link key={l.key} href={l.href} className="py-1 text-blue hover:underline">{l.label}</Link>)}
      </div>
    </li>
  );
  if (shown.length === 0) return <p style={{ minHeight: SLOT.chars }} className="text-xs italic text-dim">No characters to list yet.</p>;
  return (
    <div style={{ minHeight: SLOT.chars }}>
      <ul className="grid gap-2 sm:grid-cols-2">{front.map(card)}</ul>
      {rest.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer select-none text-dim hover:text-text">{rest.length} more characters</summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">{rest.map(card)}</ul>
        </details>
      )}
    </div>
  );
}
