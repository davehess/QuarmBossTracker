// The wolf plate. One authored moment on this page: the alpha is already
// there when you arrive, and the pack surfaces out of the dark behind her.
//
// Drawn, not masked. A circle with two triangles reads as a logo; an engraved
// specimen plate reads as a record of an animal, which is the whole conceit —
// this guild instruments itself, and the wolf is the first specimen.
//
// Symmetry is deliberate and comes free: the left half is authored once and
// mirrored, so the two sides cannot drift apart, and frontal symmetry is what
// a plate does.
type WolfProps = { className?: string; strokeWidth?: number; hatch?: boolean };

// LEFT half, mirrored in the render. Third pass, against a reference Hitya
// supplied: the earlier wolf was drawn with uniform-width strokes, which reads
// thin and soft. This one is authored as FILLED TAPERING FORMS — a ribbon that
// swells through the cheek and narrows to a point at the ear tip and chin —
// because the tapering is what gives a carved mark its weight. Nothing here is
// a stroke; every shape is filled and closed.

// The head contour, as a closed ribbon: outer edge down, inner edge back up.
const HALF_CONTOUR = [
  'M 200 88',                                    // crown, centre
  'C 176 90, 152 100, 134 122',                  // skull → ear root
  'L 103 52',                                    // up the inner ear edge, to the point
  'L 74 156',                                    // down the outer edge → temple
  'L 41 182', 'L 83 202',                        // ruff spike 1
  'L 29 250', 'L 78 268',                        // ruff spike 2
  'L 45 324', 'L 101 322',                       // ruff spike 3
  'L 149 366', 'L 200 382',                      // jaw → chin
  'L 200 360',                                   // inner edge returns
  'L 157 346', 'L 113 304', 'L 71 304',
  'L 98 262', 'L 55 246', 'L 99 202',
  'L 66 186', 'L 100 152',                       // temple, inner
  'L 118 86',                                    // ear, inner — broad, not a sliver
  'L 142 138',
  'C 158 120, 178 110, 200 108',
  'Z',
].join(' ');

// Inner ear: a solid wedge, the negative shape the reference carries.
const HALF_EAR_INNER = 'M 110 96 L 122 148 L 136 141 Z';

// Brow — a wedge, thick at the centre and tapering out over the eye.
const HALF_BROW = 'M 186 168 L 128 186 L 121 205 L 133 200 L 188 182 Z';

// Eye — angular, pointed at the outer corner. Not an almond.
const HALF_EYE = 'M 130 212 L 168 200 L 179 209 L 166 222 L 141 222 Z';

// Muzzle bridge + the cheek line that separates snout from ruff.
const HALF_SNOUT = 'M 200 244 L 158 256 L 132 300 L 145 304 L 168 266 L 200 256 Z';
const HALF_CHEEK = 'M 116 226 L 100 266 L 112 302 L 122 298 L 111 266 L 126 231 Z';

// Mouth — the curve back from the muzzle toward the jaw.
const HALF_MOUTH = 'M 200 326 L 166 332 L 143 322 L 156 340 L 200 336 Z';

const HATCHES: string[] = [];
function Half({ hatch }: { hatch: boolean }) {
  return (
    <g strokeLinejoin="round">
      <path d={HALF_CONTOUR}   className="wolf-ink" />
      <path d={HALF_EAR_INNER} className="wolf-ink" />
      <path d={HALF_BROW}      className="wolf-ink" />
      <path d={HALF_EYE}       className="wolf-eye" />
      {hatch && <path d={HALF_SNOUT} className="wolf-ink-2" />}
      {hatch && <path d={HALF_CHEEK} className="wolf-ink-2" />}
      {hatch && <path d={HALF_MOUTH} className="wolf-ink-2" />}
    </g>
  );
}

export function WolfHead({ className = '', strokeWidth = 2.4, hatch = true }: WolfProps) {
  return (
    <svg viewBox="0 0 400 400" className={className} strokeWidth={strokeWidth}
         aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
      <Half hatch={hatch} />
      <g transform="translate(400,0) scale(-1,1)"><Half hatch={hatch} /></g>
      {/* Centre furniture — authored once, never mirrored. */}
      <g strokeLinejoin="round">
        {/* Nose — a rounded triangle, the darkest mass on the face. */}
        <path d="M 176 288 C 186 278, 214 278, 224 288 C 224 302, 212 312, 200 312 C 188 312, 176 302, 176 288 Z"
              className="wolf-nose" />
      </g>
    </svg>
  );
}

// The pack. Each wolf is the same animal, further back: smaller, softer, later.
// Behind the alpha, never beside her — the reveal is depth, not a row.
const PACK = [
  { x: -26, y:  6, s: 0.62, d: '0.35s', o: 0.26, b: '1.1px' },
  { x:  26, y:  6, s: 0.62, d: '0.55s', o: 0.26, b: '1.1px' },
  { x: -44, y: 11, s: 0.44, d: '0.80s', o: 0.17, b: '2.0px' },
  { x:  44, y: 11, s: 0.44, d: '1.00s', o: 0.17, b: '2.0px' },
  { x:   0, y: 14, s: 0.38, d: '1.25s', o: 0.12, b: '2.6px' },
];

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
          <WolfHead strokeWidth={3.4} hatch={false} />
        </div>
      ))}
      <div className="wolf-alpha"><WolfHead /></div>
    </div>
  );
}
