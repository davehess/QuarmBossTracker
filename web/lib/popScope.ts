// /pop — which characters the page is about, and which body it shows (the guild lead, 2026-10-14: "The pop flags
// page should start on your characters by default, with mains being the second toggle and all characters being the
// third (grouped by mains like I mentioned)").
//
// Two independent toggles, and nothing else:
//   scope  My Characters | Mains | All characters      WHOSE flags the page counts and lists
//   view   Chart | Matrix                              HOW they are drawn
// The scope toggle always reads in that order. All characters draws its Matrix with each alt nested under its main
// (web/lib/popAltGroups.ts); ?alts=flat is the way back to the flat list.
//
// Pure, so test/pop-scope.test.js runs it for real. The page calls resolvePopView once and reads nothing raw after.
//
// Links that existed before this change keep their meaning:
//   no scope, ?zone= / ?view= / ?alts= present      Mains (the old default)
//   ?view=mine                                       My Characters
//   ?scope=all&view=matrix                           All characters, now grouped (?alts=flat for the old flat list)
// Only a bare /pop (or one carrying cosmetic params such as ?all=1, ?flags=, ?pclass=) takes the new default.

export type PopScope = 'mine' | 'mains' | 'all';
export type PopViewKind = 'chart' | 'matrix';

/** The toggle, left to right. */
export const POP_SCOPES: { key: PopScope; label: string; title: string }[] = [
  { key: 'mine', label: '🧍 My Characters',
    title: 'Every character on your account, alts included. Traders, hidden characters and characters under the lowest PoP level sit behind Show all.' },
  { key: 'mains', label: 'Mains', title: 'The raiders (Pack Leader, Officer, Raid Pack, Recruit).' },
  { key: 'all', label: 'All characters', title: 'Raiders and raid alts, each alt listed under its main on the Matrix.' },
];

export type PopParams = { scope?: string; view?: string; alts?: string; zone?: string };

export type PopViewChoice = {
  scope: PopScope;
  view: PopViewKind;
  /** The Matrix draws alts nested under their main. Only ever true for the Matrix of Mains or All. */
  groupAlts: boolean;
  /** The URL named the scope itself (false = the page chose the default). */
  explicitScope: boolean;
  /** The URL named Chart or Matrix (false = the scope's own default). The scope links carry a named view along and let an unnamed one reset. */
  explicitView: boolean;
};

const isScope = (s: string | undefined): s is PopScope => s === 'mine' || s === 'mains' || s === 'all';

/** What a visitor with no scope in the URL lands on: their own characters, or the mains when there is no "own". */
export function defaultScope(ctx: { signedIn: boolean; hasCharacters?: boolean }): PopScope {
  return ctx.signedIn && ctx.hasCharacters !== false ? 'mine' : 'mains';
}

export function resolvePopView(p: PopParams, ctx: { signedIn: boolean; hasCharacters?: boolean }): PopViewChoice {
  let scope: PopScope;
  let explicitScope = true;
  if (isScope(p.scope)) scope = p.scope;
  else if (p.view === 'mine') scope = 'mine';
  else if (p.zone || p.view || p.alts) scope = 'mains';      // a link from before the toggle existed
  else { scope = defaultScope(ctx); explicitScope = false; }

  let view: PopViewKind;
  if (p.view === 'matrix' || p.view === 'mine') view = 'matrix';
  else if (p.view === 'chart') view = 'chart';
  else if (p.alts === 'group' && scope !== 'mine') view = 'matrix';   // ?alts=group has always opened the Matrix
  else view = scope === 'mine' ? 'matrix' : 'chart';                  // My Characters is its table; the others open on the chart

  const groupAlts = view === 'matrix' && scope !== 'mine' && (p.alts === 'group' || (scope === 'all' && p.alts !== 'flat'));
  const explicitView = p.view === 'matrix' || p.view === 'chart' || p.view === 'mine';
  return { scope, view, groupAlts, explicitScope, explicitView };
}
