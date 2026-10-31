// The Danger zone's controls on /admin/overlays: one small form per flag, and the version floor's. Server components over
// applyDangerControl (dangerActions.ts), which checks the typed phrase. Setting asks for the phrase; clearing is one click.
import { VERSION_FLOOR_KEY, dangerPhrase } from '@/lib/adminTyped';
import TypedConfirm from '../TypedConfirm';
import { applyDangerControl } from './dangerActions';

const CARD = 'rounded border border-red/40 bg-bg p-3';
const SET_BTN = 'px-3 py-1.5 text-xs rounded border border-red text-red font-semibold hover:bg-red/10';
const CLEAR_BTN = 'px-3 py-1.5 text-xs rounded bg-green/80 hover:bg-green text-bg font-semibold';

export function DangerFlag({ f, on }: { f: { key: string; label: string; desc: string }; on: boolean }) {
  const phrase = dangerPhrase(f.key)!;
  return (
    <form action={applyDangerControl} className={CARD}>
      <input type="hidden" name="key" value={f.key} />
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-sm font-semibold text-text">{f.label}</span>
        <code className="text-[10px] text-dim">{f.key}</code>
        {on && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red/20 text-red border border-red/40">ON</span>}
      </div>
      {/* A danger switch's caution stays in view (components/MoreInfo.tsx: never fold a fleet-wide button's warning). */}
      <p className="text-xs text-dim leading-5">{f.desc}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {on
          ? <button type="submit" name="mode" value="clear" className={CLEAR_BTN}>Clear — back to normal</button>
          : (<>
              <TypedConfirm phrase={phrase} />
              <button type="submit" name="mode" value="set" className={SET_BTN}>Set</button>
            </>)}
      </div>
    </form>
  );
}

/** The version floor: a number, so the form carries the value as well as the phrase. */
export function DangerFloor({ current }: { current: number | null }) {
  const phrase = dangerPhrase(VERSION_FLOOR_KEY)!;
  return (
    <form action={applyDangerControl} className={CARD}>
      <input type="hidden" name="key" value={VERSION_FLOOR_KEY} />
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-sm font-semibold text-text">Minimum agent version</span>
        <code className="text-[10px] text-dim">{VERSION_FLOOR_KEY}</code>
        {current != null && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red/20 text-red border border-red/40">floor {current}</span>}
      </div>
      <p className="text-xs text-dim leading-5">
        Agents below the floor stand down like the fleet pause and show an update nudge (Mimic auto-updates handle the rest).
        Enter the numeric form of a version: <b>major×10000 + minor×100 + patch</b>, e.g. agent <b>3.3.85 → 30385</b>.
        Fail-open: an agent that cannot reach the bot runs normally. Coordinate with the guild lead first.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <input
          type="number" name="value" min={1} step={1} required defaultValue={current ?? ''} placeholder="30385"
          aria-label="Minimum agent version, numeric form"
          className="w-32 bg-bg border border-red/50 rounded px-2 py-1 text-sm text-text font-mono"
        />
        <TypedConfirm phrase={phrase} />
        <button type="submit" name="mode" value="set" className={SET_BTN}>Set floor</button>
        {current != null && (
          <button type="submit" name="mode" value="clear" formNoValidate className={CLEAR_BTN}>Clear floor</button>
        )}
      </div>
    </form>
  );
}
