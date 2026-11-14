import type { ResultView } from '@/lib/parseResultFirstView';
import { CARD, DamagePanel, Fold, LABEL, PANELS, ResultStrip, YouLine } from './shared';

// A: the result in big type, the full ranked table straight under it, everything else folded shut with a headline.
export default function VersionA({ v, linkNames }: { v: ResultView; linkNames?: boolean }) {
  return (
    <div className="space-y-4">
      <ResultStrip v={v} />
      <YouLine v={v} />
      <section className={`${CARD} py-3`} aria-label="Damage">
        <h2 className={`mb-2 px-3 ${LABEL}`}>Damage, all {v.players.length} raiders</h2>
        <DamagePanel v={v} linkNames={linkNames} />
      </section>
      <section className={CARD} aria-label="More detail">
        {PANELS.filter((p) => p.key !== 'damage').map((p) => (
          <Fold key={p.key} label={p.label} headline={p.headline(v)}>{p.body(v, linkNames)}</Fold>
        ))}
      </section>
    </div>
  );
}
