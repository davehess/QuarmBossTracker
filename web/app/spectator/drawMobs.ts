// /spectator?v=b and ?v=c: the mobs layer of the board's canvas. Called by SpectatorBoard.draw between the walls and
// the raider dots (a raider is never hidden under a monster). Same look as the replay's recorded targets
// (app/spectator/replay/ReplayBoard.tsx): a red diamond, bigger the more raiders had it targeted; a boss a big dot.
//   * a diamond fades with the age of its last sample (a mob not targeted for SIGHTING_MS is gone from the list)
//   * a boss is a ring with a dot; once its kill has happened it is a dim dot with a cross
//   * the picked mob (and every mob of the picked lane) gets a white ring
//   * names: bosses, the picked lane and mobs with 3+ targeters, never over another name
import { toScreen, type View } from '@/lib/spectator';
import { PULL_MIN_N, type MobDot } from '@/lib/mobTrack';

const RED = '#ef4444';
const BG = '#0d1117';
const LABEL_FONT = '11px "Cascadia Code", Consolas, ui-monospace, monospace';
const BOSS_R = 11;

export function mobPx(d: MobDot, v: View, ox: number, oy: number) {
  const p = toScreen(d.x, d.y);
  return { px: p.sx * v.scale + ox, py: p.sy * v.scale + oy };
}
export const mobReach = (d: MobDot) => (d.boss ? BOSS_R : 5 + Math.min(d.n, 8) * 0.7) + 6;

export function drawMobs(ctx: CanvasRenderingContext2D, dots: readonly MobDot[], selected: string | null, v: View, ox: number, oy: number, w: number, h: number) {
  ctx.save();
  ctx.lineJoin = 'round';
  // far-away samples first, the picked lane and bosses last
  const order = [...dots].sort((a, b) =>
    Number(a.lane === selected) - Number(b.lane === selected) || Number(a.boss) - Number(b.boss) || b.ageMs - a.ageMs);
  const labels: { d: MobDot; px: number; py: number; r: number }[] = [];
  for (const d of order) {
    const { px, py } = mobPx(d, v, ox, oy);
    if (px < -30 || px > w + 30 || py < -30 || py > h + 30) continue;
    const fade = Math.max(0.35, 1 - d.ageMs / 45_000);
    ctx.globalAlpha = d.dead ? 0.45 : fade;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = BG;
    let r: number;
    if (d.boss) {
      r = BOSS_R;
      ctx.fillStyle = RED;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = d.dead ? '#8b949e' : '#fecaca';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, r - 3.5, 0, Math.PI * 2); ctx.stroke();
      if (d.dead) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px - 4, py - 4); ctx.lineTo(px + 4, py + 4); ctx.moveTo(px + 4, py - 4); ctx.lineTo(px - 4, py + 4); ctx.stroke();
      }
    } else {
      r = 5 + Math.min(d.n, 8) * 0.7;
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    if (d.lane === selected) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py, r + 4, 0, Math.PI * 2); ctx.stroke();
    }
    if (d.boss || d.lane === selected || d.n >= PULL_MIN_N) labels.push({ d, px, py, r });
  }

  ctx.globalAlpha = 1;
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineWidth = 3;
  const placed: [number, number, number, number][] = [];
  // bosses and the picked lane name themselves first, so a crowded corner keeps them
  labels.sort((a, b) => Number(b.d.lane === selected || b.d.boss) - Number(a.d.lane === selected || a.d.boss) || b.d.n - a.d.n);
  for (const { d, px, py, r } of labels) {
    const text = `${d.name.length > 26 ? d.name.slice(0, 25) + '…' : d.name}${d.n > 1 ? ` ×${d.n}` : ''}`;
    const tw = ctx.measureText(text).width;
    const left = px + r + 5 + tw > w - 4;
    const lx = left ? px - r - 5 - tw : px + r + 5;
    const box: [number, number, number, number] = [lx, py - 7, lx + tw, py + 7];
    if (placed.some(p => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
    placed.push(box);
    ctx.strokeStyle = BG;
    ctx.strokeText(text, lx, py);
    ctx.fillStyle = d.boss ? '#ffffff' : '#fecaca';
    ctx.fillText(text, lx, py);
  }
  ctx.restore();
}
