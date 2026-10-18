// The tour layout's pictures, drawn in CSS and nothing else (no screenshot, no image file, no fetch). Every label is
// a placeholder (Guild One, Raider 1, Boss 1), so there is no real name on this page to leak or to go stale.
// Each figure is one role="img" with a sentence for a screen reader; its insides are hidden from it.
import type { ReactElement } from 'react';
import type { FigureKey } from '@/lib/raidmimicLanding';

const FRAME = 'rounded-md border border-border bg-bg p-3 font-mono text-[11px] leading-4 text-text';

const BOARD_ROWS: [string, string][] = [['Boss 1', 'up'], ['Boss 2', 'down'], ['Boss 3', 'soon'], ['Boss 4', 'down']];
const STATE: Record<string, string> = { up: 'text-green', down: 'text-dim', soon: 'text-gold' };

function Boards() {
  return (
    <div role="img" aria-label="Drawing of one raid board with a column for each of two guilds, listing bosses as up, down or spawning soon." className={FRAME}>
      <div aria-hidden>
        <div className="mb-2 text-center text-xs text-[#f2ede1]">Shared board</div>
        <div className="grid grid-cols-2 gap-2">
          {['Guild One', 'Guild Two'].map((g, gi) => (
            <div key={g} className="rounded border border-border bg-panel p-2">
              <div className="mb-1 text-[#f2ede1]">{g}</div>
              {BOARD_ROWS.map(([boss, st], i) => {
                const s = gi === 1 && boss === 'Boss 2' ? 'soon' : gi === 1 && boss === 'Boss 3' ? 'down' : st;
                return (
                  <div key={boss} className="flex justify-between border-t border-border py-1 first:border-t-0">
                    <span>{boss}</span><span className={STATE[s]}>{s}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const GATES = ['Gate 1', 'Gate 2', 'Boss 1', 'Boss 2'];
// 'y' holds it / can enter, 'n' still needs it, 'l' locked out
const GRID: string[] = ['yyyy', 'yyyn', 'yynl', 'ynnn', 'yyll'];
const MARK: Record<string, [string, string]> = { y: ['✓', 'text-green'], n: ['–', 'text-dim'], l: ['locked', 'text-red'] };

function Flags() {
  return (
    <div role="img" aria-label="Drawing of a grid of five raiders against four gates and bosses, showing a tick for each flag held and the word locked for each lockout." className={FRAME}>
      <div aria-hidden className="grid grid-cols-5 gap-x-1 gap-y-1">
        <div />
        {GATES.map(g => <div key={g} className="truncate text-center text-dim">{g}</div>)}
        {GRID.map((row, r) => (
          <div key={r} className="contents">
            <div className="text-[#f2ede1]">Raider {r + 1}</div>
            {row.split('').map((c, i) => <div key={i} className={`text-center ${MARK[c][1]}`}>{MARK[c][0]}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}

const BARS = [100, 82, 64, 41, 23];

function Parse() {
  return (
    <div role="img" aria-label="Drawing of three raiders’ logs merging into one ranked list of damage bars." className={FRAME}>
      <div aria-hidden>
        <div className="mb-2 flex items-center gap-2 text-dim">
          {['Log 1', 'Log 2', 'Log 3'].map(l => <span key={l} className="rounded border border-border px-1.5 py-0.5">{l}</span>)}
          <span>{'→'}</span><span className="text-[#f2ede1]">one fight</span>
        </div>
        {BARS.map((w, i) => (
          <div key={w} className="flex items-center gap-2 py-0.5">
            <span className="w-16 shrink-0 text-[#f2ede1]">Raider {i + 1}</span>
            <span className="block h-2.5 rounded-sm bg-gold/80" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const PANELS: { label: string; cls: string }[] = [
  { label: 'Timers', cls: 'left-[4%] top-[8%] h-[34%] w-[34%]' },
  { label: 'Damage', cls: 'right-[4%] top-[8%] h-[52%] w-[30%]' },
  { label: 'Buff queue', cls: 'bottom-[8%] left-[18%] h-[30%] w-[40%]' },
];

function Builder() {
  return (
    <div role="img" aria-label="Drawing of a game screen with three overlay panels, timers, damage and a buff queue, each with a handle for moving it." className={FRAME}>
      <div aria-hidden className="relative h-44 overflow-hidden rounded border border-dashed border-border">
        {PANELS.map(p => (
          <div key={p.label} className={`absolute rounded border border-gold/70 bg-panel px-1.5 py-1 ${p.cls}`}>
            <span className="text-dim">{'✥'} </span><span className="text-[#f2ede1]">{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const FIGURES: Record<FigureKey, () => ReactElement> = { boards: Boards, flags: Flags, parse: Parse, builder: Builder };

export function Figure({ k }: { k: FigureKey }) {
  const F = FIGURES[k];
  return <F />;
}
