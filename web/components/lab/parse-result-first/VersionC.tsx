import type { ResultView } from '@/lib/parseResultFirstView';
import { CARD, Fold, LABEL, PANELS, ResultStrip, YouLine, type PanelKey } from './shared';

// C: the panel for the viewer's role opens first (tank sees Tank, healer sees Heal, everyone else Damage); the rest are folds.
const FIRST: Record<ResultView['role'], PanelKey> = { tank: 'tank', heal: 'heal', damage: 'damage' };

export default function VersionC({ v, linkNames }: { v: ResultView; linkNames?: boolean }) {
  const first = PANELS.find((p) => p.key === FIRST[v.role]) ?? PANELS[0];
  const rest = PANELS.filter((p) => p.key !== first.key);
  return (
    <div className="space-y-4">
      <ResultStrip v={v} />
      <YouLine v={v} />
      <section className={`${CARD} py-3`} aria-label={first.label}>
        <h2 className={`mb-1 px-3 ${LABEL}`}>{first.label}{v.mine.length ? <span className="ml-2 normal-case tracking-normal text-blue">opened first for your role</span> : null}</h2>
        <p className="mb-2 px-3 text-sm text-text">{first.headline(v)}</p>
        {first.body(v, linkNames)}
      </section>
      <section className={CARD} aria-label="More detail">
        {rest.map((p) => <Fold key={p.key} label={p.label} headline={p.headline(v)}>{p.body(v, linkNames)}</Fold>)}
      </section>
    </div>
  );
}
