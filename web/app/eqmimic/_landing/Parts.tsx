// The pieces the eqmimic.quest landing page is assembled from (DECISIONS §209). Every sentence comes from
// web/lib/eqmimicLanding.ts; this file only decides how a block LOOKS. Server components, no client JS
// (the one client component is ScenarioPlayer.tsx): the compact piece cards are <details>.
//
// Colour is semantic here as everywhere (frontend-design): gold is the one action and the one notice,
// green is "works on your own PC", blue is "needs a guild". Nothing animates except a colour fade, and
// that is off under prefers-reduced-motion.
import type { ReactNode } from 'react';
import {
  COSTS, DOC_LINKS, FAN_PROJECT_LINE, GUIDE_LINK, HELP_LINE, HERO, HIVE, HIVE_STEPS,
  LOCAL_MODE, NOT_FINISHED, OVERLAYS, PIECES, PRIVACY_BULLETS, PRIVACY_CAVEAT, PRIVACY_URL, REPO_URL,
  RIGHTS_NOTICE, SETUP_STEPS, TROUBLESHOOTING,
  type Overlay, type Piece,
} from '@/lib/eqmimicLanding';

/** Links that differ between the eqmimic host and the Wolf Pack host (where /feedback is a different page). */
export interface Ctx {
  eqmimic: boolean;
  landing: string;      // this page's own path
  feedback: string;     // the anonymous form
  download: string;
  linux: string;
}

const BTN = 'inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold no-underline transition-colors motion-reduce:transition-none';
export const PRIMARY_BTN = `${BTN} border-gold bg-gold text-[#1a1206] hover:bg-[#e0a92c] hover:no-underline`;
const EXT = { target: '_blank', rel: 'noreferrer' } as const;

// ─── Header: compact, so the video starts high on the screen ────────────────────────────────────────
export function Header({ ctx }: { ctx: Ctx }) {
  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3">
          <h1 className="text-2xl leading-tight text-[#f2ede1] sm:text-3xl">{HERO.title}</h1>
          <a href={ctx.feedback} title="This page is new — tell us what's missing"
             className="inline-flex min-h-11 items-center rounded-md border border-orange/50 bg-orange/10 px-2.5 text-xs tracking-wider text-orange no-underline hover:text-text hover:no-underline">
            [beta]<span className="sr-only"> this page is new, tell us what&rsquo;s missing</span>
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href={ctx.download} className={PRIMARY_BTN} {...(ctx.eqmimic ? EXT : {})}>{HERO.primary}</a>
          <span className="text-xs text-dim">{HERO.primaryNote}</span>
        </div>
      </div>
      <p className="mt-1 max-w-[70ch] text-sm leading-6 text-text sm:text-base">{HERO.line}</p>
      <p className="mt-1 max-w-[70ch] text-xs leading-5 text-dim">
        {HERO.platformNote}{' '}
        <a href={ctx.linux} {...(ctx.eqmimic ? EXT : {})}>{HERO.linuxLabel}</a>
      </p>
    </header>
  );
}

// ─── The rights notice: the loudest block under the hero, and again in the footer ───────────────────
export function RightsNotice({ id }: { id?: string }) {
  return (
    <aside id={id} role="note" aria-label="Rights notice"
           className="my-6 rounded-md border border-gold/70 bg-panel p-4 sm:p-5">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-gold">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-gold" />
        Fan site notice
      </div>
      <p className="text-sm leading-6 text-text">{RIGHTS_NOTICE}</p>
      <p className="mt-2 text-sm leading-6 text-text">{FAN_PROJECT_LINE}</p>
    </aside>
  );
}

// ─── Section scaffolding ────────────────────────────────────────────────────────────────────────────
export function SectionHead({ id, title, lead, small = false }: { id: string; title: string; lead?: string; small?: boolean }) {
  return (
    <div id={id} className="scroll-mt-4">
      <h2 className={`${small ? 'text-lg' : 'text-xl sm:text-2xl'} text-[#f2ede1]`}>{title}</h2>
      {lead && <p className="mt-2 max-w-[64ch] text-sm leading-6 text-text">{lead}</p>}
    </div>
  );
}

// ─── The pieces ─────────────────────────────────────────────────────────────────────────────────────
function Flow({ flow, guild = false }: { flow: Piece['flow']; guild?: boolean }) {
  return (
    <div className="mt-3 flex flex-col items-stretch gap-1 sm:flex-row sm:items-center" aria-hidden>
      {flow.map((n, i) => (
        <div key={n.label} className="flex flex-col items-stretch gap-1 sm:flex-1 sm:flex-row sm:items-center">
          <div className={`flex-1 rounded border px-2 py-1.5 text-center text-xs leading-4 ${
            i === 1 ? (guild ? 'border-blue bg-blue/10 text-text' : 'border-gold/70 bg-gold/10 text-text') : 'border-border bg-bg text-text'}`}>
            <span className="[overflow-wrap:anywhere]">{n.label}</span>
            {n.sub && <span className="block text-[11px] text-dim">{n.sub}</span>}
          </div>
          {i < flow.length - 1 && <span className="self-center text-dim sm:px-0.5">{'→'}</span>}
        </div>
      ))}
    </div>
  );
}

function PieceBody({ p }: { p: Piece }) {
  return (
    <>
      <p className="text-sm leading-6 text-text">{p.body}</p>
      <Flow flow={p.flow} guild={p.guildOnly} />
    </>
  );
}

/** The five pieces in the order a signal travels, one line each; the paragraph and the diagram open on tap. */
export function PiecesCompact() {
  return (
    <ul className="m-0 mt-4 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-5">
      {PIECES.map((p, i) => (
        <li key={p.id} className={`rounded-md border bg-panel p-3 ${p.guildOnly ? 'border-blue/50' : 'border-border'}`}>
          <details>
            <summary className="flex min-h-11 cursor-pointer list-none flex-col justify-center">
              <span className="text-sm text-[#f2ede1]"><span className="mr-1.5 text-xs text-dim">{i + 1}</span>{p.name}</span>
              <span className="text-xs text-dim">{p.tag}</span>
            </summary>
            <div className="mt-2"><PieceBody p={p} /></div>
          </details>
        </li>
      ))}
    </ul>
  );
}

// ─── Standalone setup ───────────────────────────────────────────────────────────────────────────────
export function SetupSteps() {
  return (
    <ol className="m-0 mt-6 list-none p-0">
      {SETUP_STEPS.map((s, i) => (
        <li key={s.title} className="relative border-l border-border pb-6 pl-8 last:pb-0">
          <span className="absolute -left-[15px] top-0 flex h-[30px] w-[30px] items-center justify-center rounded-full border border-gold/60 bg-bg text-sm text-gold">
            {i + 1}
          </span>
          <h3 className="text-base text-[#f2ede1]">{s.title}</h3>
          <p className="mt-1 max-w-[64ch] text-sm leading-6 text-text">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function Troubleshooting() {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <h3 className="text-base text-[#f2ede1]">If something does not connect</h3>
      <ul className="m-0 mt-3 list-none space-y-3 p-0">
        {TROUBLESHOOTING.map(t => (
          <li key={t.sign} className="text-sm leading-6">
            <b className={t.first ? 'text-gold' : 'text-[#f2ede1]'}>{t.sign}</b>
            {t.first && <span className="ml-2 rounded border border-gold/60 px-1.5 text-[11px] text-gold">check first</span>}
            <span className="block text-text">{t.fix}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LocalModeBox() {
  return (
    <div className="rounded-md border border-green/40 bg-panel p-4">
      <h3 className="text-base text-[#f2ede1]">{LOCAL_MODE.title}</h3>
      <p className="mt-1 text-sm leading-6 text-text">{LOCAL_MODE.lead}</p>
      <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-text">
        {LOCAL_MODE.points.map(p => <li key={p}>{p}</li>)}
      </ul>
    </div>
  );
}

export function GuideLink() {
  return <p className="mt-4 text-sm"><a href={GUIDE_LINK.href} {...EXT}>{GUIDE_LINK.label}</a></p>;
}

// ─── Overlays ───────────────────────────────────────────────────────────────────────────────────────
export function ScopeBadge({ scope }: { scope: Overlay['scope'] }) {
  return scope === 'local'
    ? <span className="shrink-0 rounded border border-green/60 px-1.5 text-[11px] text-green">[local]</span>
    : <span className="shrink-0 rounded border border-blue/60 px-1.5 text-[11px] text-blue">[guild]</span>;
}

/** A card's picture slot: a clip when `clip` is set, else a still when `still` is set, else nothing at all. */
function OverlayMedia({ o }: { o: Overlay }) {
  if (o.clip) {
    return (
      <video src={o.clip} poster={o.still} controls playsInline preload="none"
             className="mb-2 aspect-video w-full rounded border border-border bg-bg object-contain" />
    );
  }
  if (o.still) {
    return <img src={o.still} alt={`${o.name} overlay`} loading="lazy" className="mb-2 aspect-video w-full rounded border border-border bg-bg object-contain" />;
  }
  return null;
}

/** The overlay gallery: every overlay as a card, tagged [local] or [guild]. */
export function OverlayGallery() {
  return (
    <ul className="m-0 mt-4 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {OVERLAYS.map(o => (
        <li key={o.name} className="rounded-md border border-border bg-panel p-3">
          <OverlayMedia o={o} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-[#f2ede1]">{o.name}</span>
            <ScopeBadge scope={o.scope} />
          </div>
          <p className="mt-1.5 text-xs leading-5 text-dim">{o.purpose}{o.note ? ` (${o.note})` : ''}</p>
        </li>
      ))}
    </ul>
  );
}

// ─── The ledger: what runs on your own PC against what needs a guild server ─────────────────────────
function LedgerColumn({ title, sub, tone, scope, children }: {
  title: string; sub: string; tone: 'green' | 'blue'; scope: Overlay['scope']; children?: ReactNode;
}) {
  return (
    <div className={`rounded-md border bg-panel p-4 ${tone === 'green' ? 'border-green/50' : 'border-blue/50'}`}>
      <h3 className={`text-base ${tone === 'green' ? 'text-green' : 'text-blue'}`}>{title}</h3>
      <p className="mt-0.5 text-xs text-dim">{sub}</p>
      <ul className="m-0 mt-3 list-none space-y-2 p-0">
        {OVERLAYS.filter(o => o.scope === scope).map(o => (
          <li key={o.name} className="flex items-start gap-3 text-sm leading-5">
            <ScopeBadge scope={scope} />
            <span className="min-w-0"><span className="text-[#f2ede1]">{o.name}</span>
              <span className="block text-xs text-dim">{o.purpose}{o.note ? ` (${o.note})` : ''}</span></span>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}

export function Ledger() {
  const guildPiece = PIECES.find(p => p.guildOnly);
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <LedgerColumn title="On your PC (free, no account)" sub="Download, run local-only, done" tone="green" scope="local" />
      <LedgerColumn title="Needs a guild server" sub="Only once your guild runs one and you sign in" tone="blue" scope="guild">
        {guildPiece && <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-text">{guildPiece.body}</p>}
        <p className="mt-3 text-xs leading-5 text-dim">In local mode these show &ldquo;needs your raid&rsquo;s Mimics&rdquo; or stay empty. <a href="#hive">How a guild runs one</a>.</p>
      </LedgerColumn>
    </div>
  );
}

export function OverlayKey() {
  return (
    <p className="mt-3 text-xs leading-5 text-dim">
      <ScopeBadge scope="local" /> works on your own PC with no account.{' '}
      <ScopeBadge scope="guild" /> needs your raid&rsquo;s Mimics, so it is empty in local mode.
    </p>
  );
}

// ─── Privacy ────────────────────────────────────────────────────────────────────────────────────────
export function PrivacyStrip() {
  return (
    <div className="mt-4">
      <ul className="m-0 grid list-none gap-px overflow-hidden rounded-md border border-border bg-border p-0 sm:grid-cols-2 lg:grid-cols-5">
        {PRIVACY_BULLETS.map(b => (
          <li key={b} className="bg-panel p-3 text-xs leading-5 text-text">{b}</li>
        ))}
      </ul>
      <PrivacyCaveat />
    </div>
  );
}

function PrivacyCaveat() {
  return (
    <p className="mt-3 max-w-[70ch] text-sm leading-6 text-text">
      <b className="text-orange">{PRIVACY_CAVEAT.split(':')[0]}:</b>
      {PRIVACY_CAVEAT.slice(PRIVACY_CAVEAT.indexOf(':') + 1)}{' '}
      <a href={PRIVACY_URL} {...EXT}>Read the full privacy page</a>.
    </p>
  );
}

// ─── Hive mind ──────────────────────────────────────────────────────────────────────────────────────
function Code({ children }: { children: string }) {
  return (
    <pre className="m-0 mt-2 overflow-x-auto rounded border border-border bg-bg px-3 py-2 text-xs leading-5 text-[#f2ede1]">
      <code>{children}</code>
    </pre>
  );
}

export function HiveSteps() {
  return (
    <ol className="m-0 mt-5 list-none p-0">
      {HIVE_STEPS.map((s, i) => (
        <li key={s.title} className="relative border-l border-border pb-5 pl-8 last:pb-0">
          <span className="absolute -left-[15px] top-0 flex h-[30px] w-[30px] items-center justify-center rounded-full border border-blue/70 bg-bg text-sm text-blue">
            {i + 1}
          </span>
          <h4 className="text-base text-[#f2ede1]">{s.title}</h4>
          <p className="mt-1 max-w-[66ch] text-sm leading-6 text-text [overflow-wrap:anywhere]">{s.body}</p>
          {s.code && <Code>{s.code}</Code>}
        </li>
      ))}
    </ol>
  );
}

export function NotFinishedBox() {
  return (
    <div role="note" className="mt-6 rounded-md border-2 border-dashed border-orange/70 bg-orange/5 p-4">
      <h4 className="text-base text-orange">{NOT_FINISHED.title}</h4>
      <ul className="m-0 mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-text">
        {NOT_FINISHED.items.map(i => <li key={i}>{i}</li>)}
      </ul>
    </div>
  );
}

export function CostsBox() {
  return (
    <div className="mt-6 rounded-md border border-border bg-panel p-4">
      <h4 className="text-base text-[#f2ede1]">{COSTS.title}</h4>
      <p className="mt-1 text-xs text-dim">{COSTS.measured}</p>
      <ul className="m-0 mt-2 list-none divide-y divide-border p-0 text-sm">
        {COSTS.rows.map(r => (
          <li key={r.what} className="flex flex-wrap justify-between gap-x-4 py-1.5">
            <span className="text-text">{r.what}</span><span className="text-[#f2ede1]">{r.cost}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-[#f2ede1]">{COSTS.total}</p>
      <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-dim">
        {COSTS.notes.map(n => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
}

export function DocLinks({ ctx }: { ctx: Ctx }) {
  return (
    <div className="mt-6 text-sm leading-7">
      <div className="flex flex-wrap gap-x-5">
        {DOC_LINKS.map(d => <a key={d.href} href={d.href} {...EXT} className="inline-flex min-h-11 items-center">{d.label}</a>)}
        <a href={REPO_URL} {...EXT} className="inline-flex min-h-11 items-center">The repository</a>
      </div>
      <p className="mt-3 text-text">
        {HELP_LINE}{' '}
        <a href={ctx.feedback} className="inline-flex min-h-11 items-center">Send us a note (no sign-in needed)</a>
      </p>
    </div>
  );
}

export function Hive({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <p className="mt-2 max-w-[66ch] text-sm leading-6 text-text">{HIVE.lead}</p>
      <h3 className="mt-5 text-lg text-[#f2ede1]">{HIVE.howTitle}</h3>
      <p className="mt-1 text-xs text-dim">{HIVE.howNote}</p>
      <HiveSteps />
      <NotFinishedBox />
      <CostsBox />
      <DocLinks ctx={ctx} />
    </>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────────────────────────────
export function LandingFooter({ ctx }: { ctx: Ctx }) {
  return (
    <footer className="mt-12 border-t border-border pt-4">
      <RightsNotice id="rights-footer" />
      <p className="text-xs leading-6 text-dim">
        <a href={ctx.feedback}>Send feedback</a> <span aria-hidden>&middot;</span>{' '}
        <a href={REPO_URL} {...EXT}>Source code</a> <span aria-hidden>&middot;</span>{' '}
        <a href={PRIVACY_URL} {...EXT}>Privacy</a> <span aria-hidden>&middot;</span>{' '}
        Licensed AGPL-3.0-or-later.
      </p>
    </footer>
  );
}
