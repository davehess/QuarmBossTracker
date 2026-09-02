// The wolf plate, and the page's one authored moment.
//
// The reveal is a sequence, not a fade (Hitya, 2026-08-28), reordered 2026-08-29
// to: her eyes in the dark → HER, whole → the pack's eyes around her → the pack.
//
// The first cut interleaved them — every eye, then every body — so the alpha
// arrived at the same time as a wall of pack. Resolving her completely before
// anything else lights gives the frame a subject to have found first, and the
// eyes that open around her afterwards read as the rest arriving, which is the
// line the page is making.
//
// ⚠ THE PACK IS OPAQUE. Depth is carried by BRIGHTNESS, never by opacity —
// `filter: brightness()` darkens the bone while leaving alpha intact, so a
// nearer wolf occludes the one behind it the way a real body would. Fading them
// with opacity let the rear wolves show straight through the front one, which
// read as ghosts rather than as distance.
//
// ⚠ Brightness alone was NOT enough, and the overlaps looked wrong on a phone
// (Hitya, 2026-08-28: "the transparency overlap looks bad"). Only the BONE is
// opaque in the keyed art — every dark line is a hole, 121,313 px of them — so
// a wolf in front was showing the wolf behind through its own linework. Each
// wolf therefore gets a filled silhouette of itself in the page ground beneath
// its plate. Invisible against the ground, and the whole difference where two
// wolves overlap.
import Image from 'next/image';

// Ordered BACK TO FRONT: DOM order is the depth order, so the nearest wolf
// paints last and covers the ones behind it.
const PACK = [
  { x:   0, y: 15, s: 0.38, bright: 0.17, blur: '2.4px', eyeAt: '2.48s', bodyAt: '3.25s' },
  { x: -45, y: 12, s: 0.45, bright: 0.24, blur: '1.8px', eyeAt: '2.36s', bodyAt: '3.10s' },
  { x:  45, y: 12, s: 0.45, bright: 0.24, blur: '1.8px', eyeAt: '2.24s', bodyAt: '2.95s' },
  { x: -27, y:  7, s: 0.63, bright: 0.36, blur: '1.0px', eyeAt: '2.12s', bodyAt: '2.80s' },
  { x:  27, y:  7, s: 0.63, bright: 0.36, blur: '1.0px', eyeAt: '2.00s', bodyAt: '2.65s' },
];

// The wolf's own outline, filled solid in the page ground: bone plus every
// hole the linework cut, found by flood-filling `wolf.png` inward from its
// border (see wolf.provenance.txt). Same canvas as the plate, so it is pinned
// to it and needs no geometry of its own.
function Solid() {
  return (
    <Image
      src="/wolf-solid.png"
      alt=""
      width={973}
      height={973}
      sizes="(max-width: 640px) 96vw, 600px"
      className="wolf-solid"
    />
  );
}

function Plate({ priority = false }: { priority?: boolean }) {
  return (
    <Image
      src="/wolf.png"
      alt=""
      width={973}
      height={973}
      priority={priority}
      sizes="(max-width: 640px) 104vw, 600px"
      className="wolf-plate h-full w-full select-none"
    />
  );
}

// ⚠ The glow is a PLATE, not a positioned blob, and it paints ON TOP.
//
// The keying left the eye interior OPAQUE BONE and cut only the dark linework,
// so a warm source behind the wolf does not read through the eye — it reads
// through the brow strokes, which is the smear this replaces (Hitya, 2026-08-28:
// "this is the area that should glow"). `wolf-eyes.png` is that exact interior,
// measured off the shipped asset as its two isolated opaque islands and painted
// gold on the same 973² canvas — so it needs no coordinates of its own and can
// never drift from the art it sits on. The pupil stays a hole, and stays dark.
function EyeGlow({ at, dim = false, priority = false }: { at: string; dim?: boolean; priority?: boolean }) {
  return (
    <Image
      src="/wolf-eyes.png"
      alt=""
      width={973}
      height={973}
      priority={priority}
      sizes="(max-width: 640px) 104vw, 600px"
      className={`wolf-eyeglow ${dim ? 'wolf-eyeglow-far' : ''}`}
      style={{ animationDelay: at }}
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
            ['--body-at' as string]: w.bodyAt,
            ['--wolf-bright' as string]: w.bright,
            ['--wolf-blur' as string]: w.blur,
          }}
        >
          <Solid />
          <Plate />
          <EyeGlow at={w.eyeAt} dim />
        </div>
      ))}
      <div className="wolf-alpha">
        <Solid />
        <Plate priority />
        <EyeGlow at="0.2s" priority />
      </div>
    </div>
  );
}
