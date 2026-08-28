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

// Outline of the LEFT half, centre-forehead to centre-chin. Mirrored in the
// render. Second pass: the first geometry read as antennae over an unclosed
// triangle — a wolf head is nearly as wide as it is tall, the muzzle is short,
// and the mass has to close or the strokes just float.
const HALF_SKULL = [
  'M 200 116',
  'C 182 117, 162 123, 147 134',        // forehead → temple
  'C 129 149, 114 170, 107 193',        // temple → cheek
  'L 92 215', 'L 109 227',              // ruff, faceted rather than scalloped
  'L 96 251', 'L 115 259',
  'C 123 277, 137 291, 155 301',        // jawline
  'C 167 308, 177 315, 185 321',        // muzzle side
  'L 200 325',                          // chin, centre
].join(' ');

// The ear is its own closed shape: broad base on the skull, tip up and out.
const HALF_EAR = [
  'M 152 129',
  'C 145 106, 135 82, 123 59',          // inner edge → tip
  'C 119 82, 113 119, 109 151',         // outer edge → temple
  'C 122 143, 138 135, 152 129', 'Z',   // base, closing along the skull
].join(' ');
const HALF_EAR_INNER = 'M 145 126 C 140 108, 133 92, 126 76';

const HALF_BROW  = 'M 124 179 C 141 168, 163 165, 183 169';
const HALF_EYE   = 'M 133 200 C 143 189, 161 188, 173 197 C 161 207, 143 208, 133 200 Z';
const HALF_CHEEK = 'M 118 214 C 133 228, 145 244, 152 262';
const HALF_JOWL  = 'M 158 292 C 170 298, 180 305, 187 313';
const HATCHES = [
  'M 133 152 C 143 160, 150 169, 155 178',
  'M 113 230 C 124 240, 132 250, 138 261',
  'M 104 256 C 114 265, 122 273, 128 282',
];

function Half({ hatch }: { hatch: boolean }) {
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      {/* The mass closes first, faintly — without it the strokes float and the
          head never reads as a head. */}
      <path d={HALF_SKULL} className="wolf-mass" />
      <path d={HALF_EAR}   className="wolf-mass" />
      <path d={HALF_EAR}   className="wolf-ink" fill="none" />
      <path d={HALF_EAR_INNER} className="wolf-ink-2" fill="none" />
      <path d={HALF_SKULL} className="wolf-ink" fill="none" />
      <path d={HALF_BROW}  className="wolf-ink-2" fill="none" />
      <path d={HALF_CHEEK} className="wolf-ink-2" fill="none" />
      <path d={HALF_JOWL}  className="wolf-ink-2" fill="none" />
      {hatch && HATCHES.map((d, i) => <path key={i} d={d} className="wolf-hatch" fill="none" />)}
      <path d={HALF_EYE} className="wolf-eye" />
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
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 200 126 L 200 288" className="wolf-hatch" />
        <path d="M 186 296 C 194 302, 206 302, 214 296 C 207 288, 193 288, 186 296 Z"
              className="wolf-nose" />
        <path d="M 200 302 L 200 316" className="wolf-ink-2" />
        <path d="M 200 315 C 194 320, 189 322, 186 321" className="wolf-ink-2" />
        <path d="M 200 315 C 206 320, 211 322, 214 321" className="wolf-ink-2" />
      </g>
    </svg>
  );
}

// The pack. Each wolf is the same animal, further back: smaller, softer, later.
// Behind the alpha, never beside her — the reveal is depth, not a row.
const PACK = [
  { x: -26, y:  6, s: 0.62, d: '0.35s', o: 0.30, b: '1.1px' },
  { x:  26, y:  6, s: 0.62, d: '0.55s', o: 0.30, b: '1.1px' },
  { x: -44, y: 11, s: 0.44, d: '0.80s', o: 0.20, b: '2.0px' },
  { x:  44, y: 11, s: 0.44, d: '1.00s', o: 0.20, b: '2.0px' },
  { x:   0, y: 14, s: 0.38, d: '1.25s', o: 0.16, b: '2.6px' },
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
