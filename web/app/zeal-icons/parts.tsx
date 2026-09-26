// Pieces shared by both /zeal-icons layouts (the catalogue and the guild pages). Server components;
// only CopyKey runs in the browser.
import Link from 'next/link';
import type { ReactNode } from 'react';
import CopyKey from './CopyKey';
import {
  BADGES, DISCORD_URL, PAW_GLYPHS, PICTURE_RULES, SYMBOLS, TAGICONS_FOLDER, markSrc, type Guild,
} from '@/lib/zealIcons';

export const H1 = 'font-[family-name:var(--font-display)] text-[clamp(1.9rem,6vw,3rem)] leading-tight text-[#f2ede1]';
export const H2 = 'font-[family-name:var(--font-display)] text-xl text-[#f2ede1]';
export const PROSE = 'font-[family-name:var(--font-prose)] text-[1.02rem] leading-7 text-text';

export function Mark({ src, alt, size }: { src: string; alt: string; size: number }) {
  // The renders are 160px; shown smaller they stay sharp on high-density screens.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={size} height={size} loading="lazy" className="block shrink-0" />;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-bg px-1 font-mono text-[0.9em] text-[#f2ede1]">{children}</code>;
}

export function Lead() {
  return (
    <p className={`${PROSE} mt-3`}>
      Put your guild&rsquo;s banner or icon over a mob, a corpse or a player, for everyone in your raid. Target
      it in EverQuest and type <Code>/tag rsay ^IEUR^Kill</Code> (or <Code>gsay</Code> for your group,{' '}
      <Code>local</Code> for only you). Each icon below has its key; click one to copy it.
    </p>
  );
}

export function StatusNote() {
  return (
    <aside className="mt-6 rounded-md border border-orange/50 bg-panel px-4 py-3 text-sm leading-6 text-text">
      <b className="text-orange">Coming to Zeal.</b> These icons are part of a Zeal update we have sent to the
      Zeal team. Until it is released, only players on that build see them; everyone else sees an ordinary
      arrow or just the text. We will say so here when it lands.
    </aside>
  );
}

export function GuildKeys({ guild }: { guild: Guild }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <CopyKey text={`^B${guild.code}^`} label={`${guild.name} banner key`} />
      <CopyKey text={`^I${guild.code}^`} label={`${guild.name} icon key`} />
    </div>
  );
}

export function InstallSteps() {
  return (
    <ol className="ml-5 list-decimal space-y-1 text-sm leading-6 text-text marker:text-dim">
      <li>Save the file into <Code>{TAGICONS_FOLDER}</Code> (make the folder if it is not there).</li>
      <li>In game, type <Code>/tag icons</Code>. It lists the pictures it found.</li>
      <li>Tag as usual: the picture shows in place of the built-in icon.</li>
    </ol>
  );
}

export function PictureDownloads({ guild, preview = true }: { guild: Guild; preview?: boolean }) {
  if (!guild.pictures?.length) return null;
  const [first] = guild.pictures;
  return (
    <div className="flex flex-wrap items-center gap-4">
      {preview && (
        <div className="rounded-md bg-[radial-gradient(ellipse_at_50%_120%,#3a4a2e,#141b10)] p-3">
          <Mark src={markSrc.picture(first.file)} alt={`${guild.name} picture`} size={96} />
        </div>
      )}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {guild.pictures.map((p, i) => (
            <a key={p.file} href={markSrc.picture(p.file)} download
               className={`inline-flex flex-col rounded-md border px-3 py-1.5 no-underline transition-colors ${
                 i === 0
                   ? 'border-[#d29922] bg-[#d29922] text-[#1a1206] hover:bg-[#e0a92c]'
                   : 'border-border bg-panel text-text hover:border-[#d29922]'}`}>
              <span className="text-sm font-semibold">{p.file}</span>
              <span className={`text-[11px] ${i === 0 ? 'text-[#1a1206]/70' : 'text-dim'}`}>
                {i === 0 ? 'use this one' : 'if the PNG does not show'} · {p.width}×{p.height}
              </span>
            </a>
          ))}
        </div>
        <p className="text-xs text-dim">Use one file, not both. Only players who have it see the picture.</p>
      </div>
    </div>
  );
}

export function SymbolsGrid({ size = 48 }: { size?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {SYMBOLS.map(s => (
        <li key={s.key} className="flex items-center gap-2 rounded-md border border-border bg-panel p-2">
          <Mark src={markSrc.symbol(s.image)} alt={s.name} size={size} />
          <div className="min-w-0 space-y-1">
            <div className="text-sm leading-tight text-[#f2ede1]">{s.name}{s.use && <span className="text-dim"> · {s.use}</span>}</div>
            <CopyKey text={`^${s.key}^`} label={`${s.name} key`} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function NumbersAndPaws() {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm text-text">Numbered badges, <Code>^1^</Code> to <Code>^12^</Code>, for a kill order.</p>
        <ul className="flex flex-wrap gap-1">
          {BADGES.map(n => (
            <li key={n} title={`^${n}^`}><Mark src={markSrc.badge(n)} alt={`Badge ${n}`} size={40} /></li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-sm text-text">
          A paw with a letter or digit, <Code>^P</Code> then the character (<Code>^PK^</Code>): a charmer&rsquo;s
          initial on their pet.
        </p>
        <ul className="flex flex-wrap gap-0.5">
          {PAW_GLYPHS.map(c => (
            <li key={c} title={`^P${c}^`}><Mark src={markSrc.paw(c)} alt={`Paw ${c}`} size={44} /></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function GetYours() {
  return (
    <div className={`${PROSE} space-y-3`}>
      <p>
        Not listed, or want your real logo? <a href={DISCORD_URL} className="text-[#d29922] hover:underline">Send it
        to us in our Discord</a>. We draw your banner and icon, turn your logo into a picture file, and post both
        here. Nothing is uploaded to this site.
      </p>
      <p className="text-sm text-dim">
        Making your own picture? Zeal takes a PNG or TGA, up to {PICTURE_RULES.maxPixels} pixels a side and
        1 MB, with a transparent background. The file name is the key: 1 to {PICTURE_RULES.maxNameLength} letters
        or digits (<Code>EUR.png</Code> is <Code>^IEUR^</Code>).
      </p>
    </div>
  );
}

// Beta only: switch between the two layouts on offer. Hidden in production builds.
export function LayoutSwitch({ current }: { current: 'a' | 'b' }) {
  if (process.env.NEXT_PUBLIC_IS_BETA !== '1') return null;
  const items: [('a' | 'b'), string, string][] = [
    ['a', 'A · one catalogue page', '/zeal-icons'],
    ['b', 'B · a page per guild', '/zeal-icons?v=b'],
  ];
  return (
    <nav className="mb-6 flex flex-wrap gap-3 text-xs text-dim" aria-label="Layout preview">
      <span>Preview layout:</span>
      {items.map(([v, label, href]) => (
        <Link key={v} href={href} className={v === current ? 'text-gold' : 'hover:text-text'}>{label}</Link>
      ))}
    </nav>
  );
}
