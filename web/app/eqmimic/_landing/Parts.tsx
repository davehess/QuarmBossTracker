// The pieces the three eqmimic.quest landing layouts are assembled from (DECISIONS §209). Every sentence
// comes from web/lib/eqmimicLanding.ts; this file only decides how a block LOOKS. Server components, no
// client JS: the section nav is plain anchors, the FAQ and the compact piece cards are <details>.
//
// Colour is semantic here as everywhere (frontend-design): gold is the one action and the one notice,
// green is "works on your own PC", blue is "needs a guild". Nothing animates except a colour fade, and
// that is off under prefers-reduced-motion.
import type { ReactNode } from 'react';
import {
  COSTS, DOC_LINKS, FAN_PROJECT_LINE, FAQ, GUIDE_LINK, HELP_LINE, HERO, HIGHLIGHTS, HIVE, HIVE_STEPS,
  LOCAL_MODE, NOT_FINISHED, OVERLAYS, PIECES, PRIVACY_BULLETS, PRIVACY_CAVEAT, PRIVACY_URL, REPO_URL,
  RIGHTS_NOTICE, SECTIONS, SETUP_STEPS, TROUBLESHOOTING,
  type Highlight, type Overlay, type Piece,
} from '@/lib/eqmimicLanding';

/** Links that differ between the eqmimic host and the Wolf Pack host (where /feedback is a different page). */
export interface Ctx {
  eqmimic: boolean;
  landing: string;      // this page's own path
  feedback: string;     // the anonymous form
  download: string;
  linux: string;
  stickyTop: string;    // a tailwind top-* class: below the Wolf Pack header when there is one
}

const BTN = 'inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold no-underline transition-colors motion-reduce:transition-none';
export const PRIMARY_BTN = `${BTN} border-gold bg-gold text-[#1a1206] hover:bg-[#e0a92c] hover:no-underline`;
export const GHOST_BTN = `${BTN} border-border bg-panel text-text hover:border-gold hover:no-underline`;
const EXT = { target: '_blank', rel: 'noreferrer' } as const;

// ─── Top strip: the [beta] badge and the layout tag ─────────────────────────────────────────────────
export function BetaBadge({ ctx, layout }: { ctx: Ctx; layout: 'a' | 'b' | 'c' }) {
  const href = (l: 'a' | 'b' | 'c') => (l === 'a' ? ctx.landing : `${ctx.landing}?v=${l}`);
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
      <div role="note" className="inline-flex min-h-11 flex-wrap items-center gap-x-2 rounded-md border border-orange/50 bg-orange/10 px-3 py-1.5 text-orange">
        <b className="tracking-wider">[beta]</b>
        <span>
          this page is new &mdash;{' '}
          <a href={ctx.feedback} className="underline hover:text-text">tell us what&rsquo;s missing</a>
        </span>
      </div>
      <nav aria-label="Layout preview" className="flex items-center gap-1 text-dim">
        <span>Layout</span>
        {(['a', 'b', 'c'] as const).map(l => (
          <a key={l} href={href(l)} aria-current={l === layout ? 'page' : undefined}
             className={`inline-flex h-11 w-11 items-center justify-center rounded border uppercase no-underline hover:no-underline ${
               l === layout ? 'border-gold text-gold' : 'border-border text-dim hover:text-text'}`}>
            {l}
          </a>
        ))}
      </nav>
    </div>
  );
}

// ─── Hero ───────────────────────────────────────────────────────────────────────────────────────────
export function Hero({ ctx, compact = false, children }: { ctx: Ctx; compact?: boolean; children?: ReactNode }) {
  return (
    <header id="what" className="scroll-mt-16">
      <h1 className={`${compact ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-5xl'} leading-tight text-[#f2ede1]`}>
        {HERO.title}
      </h1>
      <p className={`mt-3 max-w-[60ch] leading-7 text-text ${compact ? 'text-[0.95rem]' : 'text-base sm:text-lg'}`}>
        {HERO.line}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a href={ctx.download} className={PRIMARY_BTN} {...(ctx.eqmimic ? EXT : {})}>{HERO.primary}</a>
        <a href="#pieces" className={GHOST_BTN}>{HERO.secondary}</a>
        <span className="text-xs text-dim">{HERO.primaryNote}</span>
      </div>
      <p className="mt-3 max-w-[62ch] text-xs leading-5 text-text">
        {HERO.platformNote}{' '}
        <a href={ctx.linux} {...(ctx.eqmimic ? EXT : {})}>{HERO.linuxLabel}</a>
      </p>
      {children}
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
export function SectionHead({ id, n, title, lead }: { id: string; n?: number; title: string; lead?: string }) {
  return (
    <div id={id} className="scroll-mt-16">
      <h2 className="flex items-baseline gap-3 text-xl text-[#f2ede1] sm:text-2xl">
        {n != null && <span className="text-sm text-gold">{String(n).padStart(2, '0')}</span>}
        {title}
      </h2>
      {lead && <p className="mt-2 max-w-[64ch] text-sm leading-6 text-text">{lead}</p>}
    </div>
  );
}

export function SectionNav({ ctx }: { ctx: Ctx }) {
  return (
    <nav aria-label="Sections" className={`sticky ${ctx.stickyTop} z-30 my-6 rounded-md border border-border bg-bg`}>
      <ul className="flex list-none gap-1 overflow-x-auto p-1">
        {SECTIONS.map(s => (
          <li key={s.id} className="shrink-0">
            <a href={`#${s.id}`}
               className="inline-flex min-h-11 items-center rounded px-3 text-sm text-text no-underline hover:bg-panel hover:text-gold hover:no-underline">
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ─── Highlights: the video slots ────────────────────────────────────────────────────────────────────
function Clip({ h, i }: { h: Highlight; i: number }) {
  return (
    <figure className="m-0">
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-border bg-panel">
        {h.src ? (
          <video controls muted playsInline preload="none" poster={h.poster} className="h-full w-full bg-bg object-cover">
            <source src={h.src} />
          </video>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-dim"
               style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(48,54,61,0.35) 0 1px, transparent 1px 12px)' }}>
            <span aria-hidden className="block h-0 w-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-dim/70" />
            <span className="text-[11px] uppercase tracking-widest">clip coming</span>
          </div>
        )}
      </div>
      <figcaption className="mt-2 text-sm leading-5">
        <span className="text-[#f2ede1]">{h.title}</span>
        <span className="mt-0.5 block text-xs text-dim">{h.caption}</span>
      </figcaption>
      <span className="sr-only">Highlight {i + 1} of {HIGHLIGHTS.length}</span>
    </figure>
  );
}

/** `lead` makes the first clip twice as wide (the reel layout). */
export function Highlights({ lead = false }: { lead?: boolean }) {
  return (
    <ul className={`m-0 grid list-none gap-4 p-0 sm:grid-cols-2 ${lead ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
      {HIGHLIGHTS.map((h, i) => (
        <li key={h.title} className={lead && i === 0 ? 'sm:col-span-2 lg:col-span-3' : ''}>
          <div className={lead && i === 0 ? 'lg:max-w-4xl' : ''}><Clip h={h} i={i} /></div>
        </li>
      ))}
    </ul>
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

/** The journey: a trace line down the left with a node per piece, in the order a signal travels. */
export function Pieces() {
  return (
    <ol className="m-0 mt-6 list-none p-0">
      {PIECES.map((p, i) => (
        <li key={p.id} className="relative border-l border-border pb-7 pl-7 last:pb-0">
          <span aria-hidden className={`absolute -left-[7px] top-1.5 h-[13px] w-[13px] rounded-full border-2 bg-bg ${p.guildOnly ? 'border-blue' : 'border-gold'}`} />
          <h3 className="text-base text-[#f2ede1]">
            <span className="mr-2 text-xs text-dim">{i + 1}</span>{p.name}
            <span className="ml-2 text-xs font-normal text-dim">{p.tag}</span>
          </h3>
          {p.guildOnly && (
            <span className="mt-1 inline-block rounded border border-blue/60 px-1.5 text-[11px] text-blue">only if you sign in to a guild</span>
          )}
          <div className="mt-2 max-w-[68ch]"><PieceBody p={p} /></div>
        </li>
      ))}
    </ol>
  );
}

/** The same five pieces, one line each; the paragraph and the diagram open on tap. */
export function PiecesCompact() {
  return (
    <ul className="m-0 mt-5 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-5">
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

export function OverlayList() {
  return (
    <ul className="m-0 mt-5 list-none divide-y divide-border rounded-md border border-border bg-panel p-0">
      {OVERLAYS.map(o => (
        <li key={o.name} className="flex items-start gap-3 px-3 py-2.5">
          <ScopeBadge scope={o.scope} />
          <div className="min-w-0 text-sm leading-5">
            <span className="text-[#f2ede1]">{o.name}</span>
            <span className="block text-xs text-dim">{o.purpose}{o.note ? ` (${o.note})` : ''}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OverlayGrid() {
  return (
    <ul className="m-0 mt-5 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {OVERLAYS.map(o => (
        <li key={o.name} className="rounded-md border border-border bg-panel p-3">
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

export function OverlayKey() {
  return (
    <p className="mt-3 text-xs leading-5 text-dim">
      <ScopeBadge scope="local" /> works on your own PC with no account.{' '}
      <ScopeBadge scope="guild" /> needs your raid&rsquo;s Mimics, so it is empty in local mode.
    </p>
  );
}

// ─── Privacy ────────────────────────────────────────────────────────────────────────────────────────
export function PrivacyList() {
  return (
    <div className="mt-4">
      <ul className="m-0 list-none space-y-2 p-0">
        {PRIVACY_BULLETS.map(b => (
          <li key={b} className="flex gap-3 text-sm leading-6 text-text">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green" />{b}
          </li>
        ))}
      </ul>
      <PrivacyCaveat />
    </div>
  );
}

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

export function HiveSteps({ compact = false }: { compact?: boolean }) {
  return (
    <ol className="m-0 mt-5 list-none p-0">
      {HIVE_STEPS.map((s, i) => (
        <li key={s.title} className="relative border-l border-border pb-5 pl-8 last:pb-0">
          <span className="absolute -left-[15px] top-0 flex h-[30px] w-[30px] items-center justify-center rounded-full border border-blue/70 bg-bg text-sm text-blue">
            {i + 1}
          </span>
          <h4 className="text-base text-[#f2ede1]">{s.title}</h4>
          <p className="mt-1 max-w-[66ch] text-sm leading-6 text-text [overflow-wrap:anywhere]">{s.body}</p>
          {!compact && s.code && <Code>{s.code}</Code>}
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

export function Hive({ ctx, compact = false }: { ctx: Ctx; compact?: boolean }) {
  return (
    <>
      <p className="mt-2 max-w-[66ch] text-sm leading-6 text-text">{HIVE.lead}</p>
      <h3 className="mt-6 text-lg text-[#f2ede1]">{HIVE.howTitle}</h3>
      <p className="mt-1 text-xs text-dim">{HIVE.howNote}</p>
      <HiveSteps compact={compact} />
      <NotFinishedBox />
      <CostsBox />
      <DocLinks ctx={ctx} />
    </>
  );
}

// ─── FAQ ────────────────────────────────────────────────────────────────────────────────────────────
export function Faq() {
  return (
    <div className="mt-4 divide-y divide-border rounded-md border border-border bg-panel">
      {FAQ.map(f => (
        <details key={f.q} className="group px-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm text-[#f2ede1]">
            {f.q}
            <span aria-hidden className="text-dim group-open:rotate-45">+</span>
          </summary>
          <p className="pb-3 text-sm leading-6 text-text">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────────────────────────────
export function LandingFooter({ ctx }: { ctx: Ctx }) {
  return (
    <footer className="mt-14 border-t border-border pt-4">
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
