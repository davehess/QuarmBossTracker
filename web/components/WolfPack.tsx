// The wolf plate, and the page's one authored moment.
//
// The reveal is a sequence, not a fade (Hitya, 2026-08-28): the alpha's eyes
// open in the dark first, then the pack's eyes behind her, then her own lines
// resolve, then the pack resolves one by one, nearest first.
//
// ⚠ THE PACK IS OPAQUE. Depth is carried by BRIGHTNESS, never by opacity —
// `filter: brightness()` darkens the bone while leaving alpha intact, so a
// nearer wolf occludes the one behind it the way a real body would. Fading them
// with opacity let the rear wolves show straight through the front one, which
// read as ghosts rather than as distance.
import Image from 'next/image';

// Measured on the shipped asset, as a fraction of its square. The keyed art
// leaves the eye slits TRANSPARENT, so a warm source behind the plate reads
// through them and nowhere else.
const EYES = [{ x: 34.5, y: 41.5 }, { x: 65.5, y: 41.5 }];

// Ordered BACK TO FRONT: DOM order is the depth order, so the nearest wolf
// paints last and covers the ones behind it.
const PACK = [
  { x:   0, y: 15, s: 0.38, bright: 0.17, blur: '2.4px', eyeAt: '1.30s', bodyAt: '2.85s' },
  { x: -45, y: 12, s: 0.45, bright: 0.24, blur: '1.8px', eyeAt: '1.12s', bodyAt: '2.62s' },
  { x:  45, y: 12, s: 0.45, bright: 0.24, blur: '1.8px', eyeAt: '1.00s', bodyAt: '2.50s' },
  { x: -27, y:  7, s: 0.63, bright: 0.36, blur: '1.0px', eyeAt: '0.86s', bodyAt: '2.28s' },
  { x:  27, y:  7, s: 0.63, bright: 0.36, blur: '1.0px', eyeAt: '0.74s', bodyAt: '2.16s' },
];

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

function Eyes({ at, scale = 1 }: { at: string; scale?: number }) {
  return (
    <>
      {EYES.map((e, i) => (
        <span
          key={i}
          className="wolf-eyelight"
          style={{
            left: `${e.x}%`,
            top: `${e.y}%`,
            animationDelay: at,
            ['--eye-scale' as string]: scale,
          }}
        />
      ))}
    </>
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
          <Eyes at={w.eyeAt} scale={0.8} />
          <Plate />
        </div>
      ))}
      <div className="wolf-alpha">
        <Eyes at="0.2s" />
        <Plate priority />
      </div>
    </div>
  );
}
