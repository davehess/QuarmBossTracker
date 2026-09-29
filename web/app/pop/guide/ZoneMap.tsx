// A rough zone map for a PoP guide step (the guild lead, 2026-09-29: "the pop guide page needs some
// love. more detail, maps…"). The outline is the zone's own placement data (zone_outline(): every
// spawn point, door and ground spawn snapped to a grid), so no map file is borrowed; gold dots are the
// NPCs the step sends you to, blue diamonds are the doors that lead to other zones.
//
// EQ's axes: +Y is north and +X is WEST, so the picture draws (-x, -y) to put north up and east
// right. /map and /loc print Y then X; the tooltips say it the same way.

export type ZoneOutline = { zone: string; cell: number; pts: [number, number][]; doors: { x: number; y: number; to: string; name: string | null }[] };
export type MapMark = { x: number; y: number; label: string };

export default function ZoneMap({ outline, marks, title, height = 180 }: {
  outline: ZoneOutline | null; marks: MapMark[]; title: string; height?: number;
}) {
  if (!outline || outline.pts.length === 0) return null;
  const all: [number, number][] = [...outline.pts, ...marks.map(m => [m.x, m.y] as [number, number])];
  const sx = (x: number) => -x;
  const sy = (y: number) => -y;
  const xs = all.map(p => sx(p[0])), ys = all.map(p => sy(p[1]));
  const pad = outline.cell * 1.5;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const w = maxX - minX, h = maxY - minY;
  const r = Math.max(w, h) / 90;           // marker size scales with the zone
  const dot = outline.cell * 0.42;
  return (
    <figure className="m-0">
      <svg viewBox={`${minX} ${minY} ${w} ${h}`} role="img" aria-label={title}
           className="w-full rounded border border-border bg-bg" style={{ height }} preserveAspectRatio="xMidYMid meet">
        <title>{title}</title>
        <g fill="#30363d">
          {outline.pts.map(([x, y], n) => (
            <rect key={n} x={sx(x) - dot} y={sy(y) - dot} width={dot * 2} height={dot * 2} rx={dot * 0.4} />
          ))}
        </g>
        <g fill="#58a6ff">
          {outline.doors.map((d, n) => (
            <g key={n}>
              <title>{`Zone to ${d.name ?? d.to} · /map ${d.y} ${d.x}`}</title>
              <rect x={sx(d.x) - r * 0.9} y={sy(d.y) - r * 0.9} width={r * 1.8} height={r * 1.8}
                    transform={`rotate(45 ${sx(d.x)} ${sy(d.y)})`} opacity={0.85} />
            </g>
          ))}
        </g>
        {marks.map((m, n) => {
          // A label on the right half reads leftwards, so it never runs off the picture.
          const right = sx(m.x) > (minX + maxX) / 2;
          return (
            <g key={n}>
              <title>{`${m.label} · /map ${m.y} ${m.x}`}</title>
              <circle cx={sx(m.x)} cy={sy(m.y)} r={r * 2.2} fill="none" stroke="#d29922" strokeWidth={r * 0.5} opacity={0.55} />
              <circle cx={sx(m.x)} cy={sy(m.y)} r={r * 1.1} fill="#d29922" />
              <text x={sx(m.x) + (right ? -r * 2.6 : r * 2.6)} y={sy(m.y) + r * 0.9} textAnchor={right ? 'end' : 'start'}
                    fill="#c9d1d9" fontSize={r * 3.2}
                    style={{ paintOrder: 'stroke' }} stroke="#0d1117" strokeWidth={r * 0.8}>{m.label}</text>
            </g>
          );
        })}
        <text x={maxX - r * 2} y={minY + r * 4} fill="#6e7681" fontSize={r * 3} textAnchor="end">N ↑</text>
      </svg>
      <figcaption className="text-[10px] text-dim mt-0.5">
        Drawn from the server’s spawn points, not a game map: gold is who you need, blue diamonds are zone doors.
      </figcaption>
    </figure>
  );
}
