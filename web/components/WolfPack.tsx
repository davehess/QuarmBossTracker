// The wolf plate. One authored moment on the landing page: the alpha is already
// there when you arrive, and the pack surfaces out of the dark behind her.
//
// The mark is a raster now (web/public/wolf.png) rather than the hand-authored
// SVG this file used to carry. Four passes of bezier work got close to the
// reference in weight and structure but not to its finish, and the craft floor
// is explicit that open-ended self-QA is worse than stopping. Provenance and
// the keying pipeline: web/public/wolf.provenance.txt.
//
// Everything below the asset is unchanged: same composition, same stagger, same
// blur-and-mask reveal, same reduced-motion contract.
import Image from 'next/image';

// The pack. Each wolf is the same animal, further back: smaller, softer, later.
// Behind the alpha, never beside her — the reveal is depth, not a row.
const PACK = [
  { x: -26, y:  6, s: 0.62, d: '0.35s', o: 0.26, b: '1.1px' },
  { x:  26, y:  6, s: 0.62, d: '0.55s', o: 0.26, b: '1.1px' },
  { x: -44, y: 11, s: 0.44, d: '0.80s', o: 0.17, b: '2.0px' },
  { x:  44, y: 11, s: 0.44, d: '1.00s', o: 0.17, b: '2.0px' },
  { x:   0, y: 14, s: 0.38, d: '1.25s', o: 0.12, b: '2.6px' },
];

// Measured on the shipped asset, as a fraction of its square. The keyed art
// leaves the eye slits TRANSPARENT, so a warm source behind the plate reads
// through them and nowhere else — which is how the eyes stay the only lit
// thing on the page without painting anything onto the wolf.
const EYES = [{ x: 34.5, y: 41.5 }, { x: 65.5, y: 41.5 }];

function Plate({ priority = false }: { priority?: boolean }) {
  return (
    <Image
      src="/wolf.png"
      alt=""
      width={973}
      height={973}
      priority={priority}
      sizes="(max-width: 640px) 104vw, 600px"
      className="h-full w-full select-none"
    />
  );
}

export default function WolfPack({ className = '' }: { className?: string }) {
  return (
    <div className={`wolf-stage ${className}`} aria-hidden="true">
      {PACK.map((w, i) => (
        <div
          key={i}
          className="wolf-packmember"
          style={{
            left: `calc(50% + ${w.x}%)`,
            top: `${w.y}%`,
            width: `${w.s * 100}%`,
            animationDelay: w.d,
            ['--wolf-o' as string]: w.o,
            ['--wolf-b' as string]: w.b,
          }}
        >
          <Plate />
        </div>
      ))}
      <div className="wolf-alpha">
        {EYES.map((e, i) => (
          <span key={i} className="wolf-eyelight"
                style={{ left: `${e.x}%`, top: `${e.y}%` }} />
        ))}
        <Plate priority />
      </div>
    </div>
  );
}
