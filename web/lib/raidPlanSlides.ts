// The raid-night plan as /screen slides (the guild lead picked option A, 2026-10-14: an officer presses "Load
// tonight's plan" in the slide editor and the plan becomes slides in the existing deck).
//
// Pure: PLAN + PREFLAGS + TRAVEL_BASICS in, [{ title, body }] out. The route writes them; the tests run this for
// real. Bodies follow the slide format (lib/raidScreen.ts parseSlideBody): paragraphs, and "- " bullets one to a
// line. Loot is not here on purpose: the page reads it live.
import { PLAN, PREFLAGS, RAID_DATE_LINE, TRAVEL_BASICS, type Boss } from './raidPlan';
import { BODY_MAX, TITLE_MAX } from './raidScreen';

/** Every plan slide's title starts with this, so a reload can find (and replace) exactly the plan's own slides. */
export const PLAN_SLIDE_PREFIX = 'Plan · ';

// The deck holds SLIDES_MAX (40). The plan takes at most 30 of them, so officers keep at least ten slides of
// their own beside it. planSlides() throws past this instead of dropping the tail: a silent cut would lose
// Valor, the last target of the night, and the test fails first.
export const PLAN_SLIDES_MAX = 30;

export type PlanSlide = { title: string; body: string };

export const isPlanSlideTitle = (title: string): boolean => title.startsWith(PLAN_SLIDE_PREFIX);

/** A group is a header line plus its bullets (or one paragraph): it stays on one slide when it can. */
type Group = string[];

/** Break one over-long line at the last space inside the limit; a line with no space is cut at the limit. */
function chop(line: string): string[] {
  const out: string[] = [];
  let rest = line;
  while (rest.length > BODY_MAX) {
    const at = rest.lastIndexOf(' ', BODY_MAX);
    const cut = at > 0 ? at : BODY_MAX;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Fill slides front to back with whole groups, blank line between groups. A group too long for an empty slide
 * is split by line. Several slides get "(1/2)", "(2/2)" on the title: nothing is truncated.
 */
export function pack(title: string, groups: Group[]): PlanSlide[] {
  const pages: string[] = [];
  let cur = '';
  const add = (text: string, sep: string) => {
    if (cur && (cur + sep + text).length > BODY_MAX) { pages.push(cur); cur = ''; }
    cur = cur ? cur + sep + text : text;
  };
  for (const g of groups.filter(x => x.length)) {
    const whole = g.join('\n');
    if (whole.length <= BODY_MAX) { add(whole, '\n\n'); continue; }
    g.flatMap(chop).forEach(line => add(line, '\n'));
  }
  if (cur) pages.push(cur);
  const n = pages.length;
  return pages.map((body, i) => ({
    title: `${PLAN_SLIDE_PREFIX}${title}${n > 1 ? ` (${i + 1}/${n})` : ''}`,
    body,
  }));
}

const bullets = (items: string[]): string[] => items.map(t => `- ${t}`);

function bossGroups(b: Boss): Group[] {
  const g: Group[] = [[b.stats], [b.abilities]];
  if (b.mechanics.length) g.push(['What it does:', ...bullets(b.mechanics)]);
  if (b.before?.length) g.push(['Before this one:', ...bullets(b.before)]);
  if (b.after?.length) g.push(['After the kill:', ...bullets(b.after)]);
  if (b.history) g.push([b.history]);
  return g;
}

/** The plan as slides, in the order the night runs. Throws when it would pass PLAN_SLIDES_MAX or a title limit. */
export function planSlides(): PlanSlide[] {
  const out: PlanSlide[] = [];

  out.push(...pack('Tonight', [
    [RAID_DATE_LINE],
    ['Targets, in order:', ...bullets(PLAN.map(s => s.title))],
    [`${TRAVEL_BASICS.title}:`, ...bullets(TRAVEL_BASICS.points)],
  ]));

  out.push(...pack('Preflags', [bullets(PREFLAGS.map(p => `${p.label} (for ${p.target}): ${p.why}`))]));

  for (const s of PLAN) {
    out.push(...pack(`${s.zoneName}: before and travel`, [
      ['Before:', ...bullets(s.before)],
      ['Getting there:', ...bullets(s.travel)],
    ]));
    for (const b of s.bosses) out.push(...pack(b.name, bossGroups(b)));
  }

  if (out.length > PLAN_SLIDES_MAX) throw new Error(`the plan is ${out.length} slides, over the ${PLAN_SLIDES_MAX} it may take`);
  const long = out.find(s => s.title.length > TITLE_MAX);
  if (long) throw new Error(`plan slide title is over ${TITLE_MAX} characters: ${long.title}`);
  return out;
}
