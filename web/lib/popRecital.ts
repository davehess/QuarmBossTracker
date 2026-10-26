// Read what Seer Mal Nae`Shi says (the guild lead, 2026-10-14: "reverse engineer this so that peoples flags can
// just copy what the seer says and fix their flags and get next steps"). Sit, say "guided meditation", and she
// prints one fixed sentence for every flag the character holds. Paste those lines (timestamps or not) and this
// names the flag steps they prove, what is still ahead, and the lines it did not recognise.
//
// The tables are the bot's and the agent's, copied here because the site imports nothing from outside web/
// (vercel.json's ignoreCommand depends on that). test/pop-seer-paste.test.js fails when either copy drifts from
// utils/popFlagStages.js, the way test/pop-who.test.js keeps GATE_IMPLIES in step. The sentences themselves were
// read off Quarm's poknowledge/Seer_Mal_Nae-Shi.lua (eqemu_quest_scripts) on 2026-10-14.
//
// Pure, so the rules are testable without a database and the browser can run them: the paste never has to leave
// the page just to be read. Only a save sends anything, and then only the sentences that matched.

import { POP_FLAGS, POP_ZONES, zoneAccess, type PopNode } from './popFlags';
import { POP_STEPS, STEP_IMPLIES, type PopStep } from './popSteps';

// [opening of the sentence, stage]. She shows only the latest value of a series, which is why STAGE_IMPLIES fills
// in what a later value proves. COPY of RECITAL_STAGES in utils/popFlagStages.js.
export const RECITAL_STAGES: [string, string][] = [
  ['Your soul has formed a bond with the Plane of Time', 'time_1'],
  ['The History translated for you reveals the fate of Zebuxoruk', 'zebuxoruk_1'],
  ["Learning of Zebuxoruk's fate, the only way to save him", 'zebuxoruk_2'],
  ['The information obtained from Mithaniel is written', 'mmarr_book_1'],
  ['You have shown your prowess in battle to Askr', 'karana_1'],
  ['You have obtained the Talisman of Thunderous Foyer from Askr', 'karana_2'],
  ['The information obtained from Karana is written', 'karana_4'],
  ['The Cipher of the Divine Language appears on your arms', 'cipher_1'],
  ['Saryrn been destroyed.', 'saryrn_1'],
  ['Mithaniel has been bested.', 'mmarr_1'],
  ["You have completed all of Honor's Trials.", 'hohtrials_111'],
  ["You have beaten Rydda`Dar in the first of Honor's Trials.", 'hoh_trial_1'],
  ["You have saved the villagers in the second of Honor's Trials.", 'hoh_trial_2'],
  ["You have defeated the nomads in the third of Honor's Trials.", 'hoh_trial_3'],
  ['You have bested Aerin`Dar and proven yourself honorable enough', 'aerindar_2'],
  ['The evidence of Mavuin is the only thing that can save him now.', 'mavuin_1'],
  ['Having endured the trials, the Tribunal has agreed to reconsider', 'mavuin_2'],
  ['Mavuin is grateful to you for taking his case before the Tribunal.', 'mavuin_3'],
  ['Tylis is being tortured by Saryrn.', 'tylis_1'],
  ['Tylis has been removed from his agony.', 'tylis_2'],
  ['Thelin being tormented by the imagery of Terris Thule', 'thelin_1'],
  ['Thelin has completed his pact with Terris Thule', 'thelin_2'],
  ["Terris Thule's grasp over Thelin has been released.", 'thelin_3'],
  ['Saved from a world of eternal nightmares, Thelin is forever in your debt.', 'thelin_4'],
  ['Alder Fuirstel wishes you to obtain the Ward', 'fuirstel_1'],
  ['Grummus has been destroyed, about his corpse you found a small ward', 'fuirstel_2'],
  ['Milyk has been saved from certain death, but is not recovering.', 'fuirstel_3'],
  ['Bertoxxulous has been slain, the curse from Milyk now lifted.', 'fuirstel_4'],
  ['Saved from certain doom, Milyk and Adler are forever in your debt.', 'fuirstel_5'],
  ['Now that Grummus has been destroyed, the entrance to the Crypt of Bertoxxulous', 'grummus_1'],
  ['The portal into the Plane of Fire has been altered.', 'pofire_1'],
  ["Xuzl's arcane wisdom pulses in your mind.", 'sol_room_1'],
  ["Arlyxir's wealth of knowledge flows through your mind.", 'sol_room_2'],
  ['The power of Dresolik surges through you.', 'sol_room_3'],
  ["Rizlona's song slips through your thoughts.", 'sol_room_4'],
  ["Jiva's strength fills your body.", 'sol_room_5'],
  ['The true route to the Plane of Fire is now clear in your mind.', 'pofire_2'],
  ['Giwin would like you to find him in Drunder', 'zeks_2'],
  ['The pack of notes from Vallon are scribbled', 'zeks_3'],
  ['The pack of notes from Tallon are scribbled', 'zeks_4'],
  ["The words of Maelin echo in your mind, 'The Zeks and Solusek", 'zeks_6'],
  ['The parchments of Rallos are scribed in a language', 'zeks_7'],
  ["You remember Nitram's words", 'poi_door_1'],
];

// What a stage proves in the catalog's terms (web/lib/popFlags.ts). COPY of STAGE_IMPLIES in utils/popFlagStages.js.
export const STAGE_IMPLIES: Record<string, string[]> = {
  mavuin_3: ['trial_justice'],
  fuirstel_2: ['grummus_dead'], fuirstel_3: ['grummus_dead'], grummus_1: ['grummus_dead'],
  fuirstel_4: ['grummus_dead', 'bert_dead'], fuirstel_5: ['grummus_dead', 'bert_dead'],
  bertox_key_1: ['carprin_cycle'],
  thelin_2: ['hedge_event'], thelin_3: ['hedge_event', 'tthule_dead'], thelin_4: ['hedge_event', 'tthule_dead'],
  zeks_2: ['behemoth_dead'],
  zeks_3: ['behemoth_dead', 'vallon_dead'], zeks_4: ['behemoth_dead', 'tallon_dead'],
  zeks_5: ['behemoth_dead', 'vallon_dead', 'tallon_dead'], zeks_6: ['behemoth_dead', 'vallon_dead', 'tallon_dead'],
  zeks_7: ['behemoth_dead', 'vallon_dead', 'tallon_dead', 'rallos_dead', 'zeks_6'],
  aerindar_2: ['aerindar_dead'],
  tylis_2: ['keeper_dead'],
  saryrn_1: ['saryrn_dead'],
  mmarr_1: ['marr_dead'], hohtrials_111: ['hoh_trials'],
  cipher_1: ['saryrn_dead', 'marr_dead'],
  karana_3: ['askr_quest'], karana_4: ['askr_quest', 'agnarr_dead'],
  zebuxoruk_1: ['askr_quest', 'agnarr_dead', 'marr_dead'], zebuxoruk_2: ['askr_quest', 'agnarr_dead', 'marr_dead'],
  earthb_key_1: ['arbitor_dead'],
  pofire_2: ['solro_dead'],
  time_1: ['fennin_dead', 'coirnav_dead', 'rathe_dead', 'xegony_dead'],
};

// The same text the bot compares: quotes and backticks are one mark (a log writes Aerin`Dar and Honor's), runs of
// whitespace are one space (the Seer joins two sentences with two), case is ignored.
export const norm = (s: string) => String(s ?? '')
  .replace(/[‘’ʼ`]/g, "'")
  .replace(/\s+/g, ' ').trim().toLowerCase();
const NORMED = RECITAL_STAGES.map(([prefix, stage]) => ({ prefix: norm(prefix), stage }));

// ── The Seer's PENDING memories ──────────────────────────────────────────────
// A kill whose step before it was missing leaves a checklist flag instead of the step ("cl_grummus"; the projection
// said "Now that Grummus has fallen…"). When the member says 'unlock memories' the Seer walks the table below
// (poknowledge/Seer_Mal_Nae-Shi.lua `checklistFlags`, eqemu_quest_scripts body lines 45-137, read 2026-10-26;
// UnlockMemories at 332): if the step the memory waits for is held she prints the unlocked text and grants the new
// value, and if not she prints the SECOND entry of the row, copied verbatim as `text` here. Two rows (cl_maze,
// cl_behemoth) have no such text in the script (`""`), so the Seer says nothing for them.
//   needs  the step the script's row asks for (its 4th/5th entries: `fuirstel`, `1` = fuirstel_1). popflags.cpp
//          PopFlagsHasReadyMemory (popflags.cpp:126-150, 11024c19) tests the same pairs.
//   gives  the step the unlock writes (6th/7th entries).
// A pending memory proves a KILL and that the step is NOT yet held. It is never a completed step: the key is the
// existing checklist flag_key ('cl_grummus', source 'recital'), which has no STEP_IMPLIES/STAGE_IMPLIES entry, so
// stepsHeld()/heldClosure() carry nothing from it. COPY of PENDING_RECITAL in utils/popFlagStages.js (openings only).
export type PendingMemory = { key: string; text: string | null; needs: string; gives: string };
export const PENDING_MEMORIES: PendingMemory[] = [
  { key: 'cl_grummus', needs: 'fuirstel_1', gives: 'fuirstel_2',
    text: "You remember seeing a small trinket by Grummus' body and wondering what it was for. Perhaps speaking to someone near the Plane of Disease will shed some light on the situation." },
  { key: 'cl_maze', needs: 'thelin_1', gives: 'thelin_2', text: null },
  { key: 'cl_behemoth', needs: 'zeks_1', gives: 'zeks_2', text: null },
  { key: 'cl_aerindar', needs: 'mavuin_3', gives: 'aerindar_2',
    text: 'You have defeated Aerin`Dar but have yet to learn the true meaning of Justice.' },
  { key: 'cl_terris', needs: 'thelin_2', gives: 'thelin_3',
    text: 'Terris still haunts your nightmares whenever you attemt to recall your battle with her.' },   // "attemt": the script's own spelling
  { key: 'cl_bertox', needs: 'fuirstel_3', gives: 'fuirstel_4',
    text: 'As you recall your memory of your battle against the Plaguebringer, an image of the Fuirstel brothers flashes through your mind.' },
  { key: 'cl_keeper', needs: 'tylis_1', gives: 'tylis_2',
    text: 'Although it was kind of you to help him, Tylis still seems to have no idea who you are.' },
  { key: 'cl_saryrn', needs: 'tylis_2', gives: 'saryrn_1',
    text: 'You attempt to recall your defeat of Saryrn, but whenever you try to focus you feel a searing pain on your arm.' },
  // Vallon and Tallon share the zeks series: either also unlocks from the other's value (zeks 4 / 3), which the
  // script special-cases (UnlockMemories). `needs` zeks_2 is the one value both always accept.
  { key: 'cl_vallon', needs: 'zeks_2', gives: 'zeks_3',
    text: 'Vallon fell before you with great ease, you seem to remember some strange pouches around his body, but... well it is probably nothing.' },
  { key: 'cl_tallon', needs: 'zeks_2', gives: 'zeks_4',
    text: 'Tallon fell before you with great ease, you seem to remember some strange pouches around his body, but... well it is probably nothing.' },
  { key: 'cl_rallos', needs: 'zeks_6', gives: 'zeks_7',
    text: "Your heart beat speeds as you recall the Warlord's flaming axe, behind the dark sockets of his helm you sense darker intentions." },
  { key: 'cl_karana', needs: 'karana_3', gives: 'karana_4',
    text: 'You recall meeting with Karana, but the memory is clouded.  You sense that the answer you seek may be in Storms.' },
  { key: 'cl_mmarr', needs: 'hohtrials_111', gives: 'mmarr_1',
    text: "An Image of Mithaniel flashes before you, 'You have yet to earn a place of Honor.  When you have, we will speak again.'" },
  { key: 'cl_mmarr_book', needs: 'hohtrials_111', gives: 'mmarr_book_1',
    text: "An image of Mithaniel flashes before you.  He looks up from a small book in his hands and smiles at you, 'You have not yet earned the Honor to see these words.'" },
  { key: 'cl_solusek', needs: 'zeks_7', gives: 'pofire_2', text: 'Besting the Burning Prince proves your might, but you still must prove your warrior\'s spirit.' },
];
const PENDING_BY_KEY = new Map(PENDING_MEMORIES.map(m => [m.key, m]));
/** How much of a pending sentence is matched: the bot and the agent match an opening, a long copy can wrap. */
export const PENDING_OPENING = 60;
const PENDING_NORMED = PENDING_MEMORIES.flatMap(m => (m.text ? [{ key: m.key, prefix: norm(m.text).slice(0, PENDING_OPENING) }] : []));

const STEP_BY_KEY = new Map(Object.values(POP_STEPS).flat().map(s => [s.key, s]));
// The one prerequisite that is a bit string (hohtrials 111), not a catalog step of its own.
const EXTRA_LABEL: Record<string, string> = { hohtrials_111: "Win all three of Honor's Trials" };

export type PendingHint = {
  key: string;
  /** ready: the step it waits for is held, so 'unlock memories' will grant it. blocked: that step is missing.
   *  moot: the step it would grant is already held (a stale memory; nothing to do). */
  state: 'ready' | 'blocked' | 'moot';
  /** The step to do next: the missing prerequisite when blocked, the step 'unlock memories' grants when ready. */
  step: string | null;
  text: string;
};

/** A pending memory → what to do next. Pure: `held` is stepsHeld()/heldClosure() of what the member holds.
 *  null for a key that is not a checklist memory. */
export function pendingHint(key: string, held: ReadonlySet<string>): PendingHint | null {
  const m = PENDING_BY_KEY.get(key);
  if (!m) return null;
  const label = (k: string) => STEP_BY_KEY.get(k)?.label ?? EXTRA_LABEL[k] ?? k;
  if (held.has(m.gives)) return { key, state: 'moot', step: null, text: `Already done: ${label(m.gives)}.` };
  if (held.has(m.needs)) {
    return { key, state: 'ready', step: m.gives, text: "Ready: sit near Seer Mal Nae`Shi and say 'unlock memories' — it grants: " + label(m.gives) + '.' };
  }
  const s = STEP_BY_KEY.get(m.needs);
  const where = s?.where ? ` (${s.where})` : '';
  return { key, state: 'blocked', step: m.needs, text: `Do this first: ${label(m.needs)}${where}. Then say 'unlock memories' to Seer Mal Nae\`Shi.` };
}

/** Every pending memory in `keys`, as hints, in the Seer's table order. */
export function pendingNext(keys: Iterable<string>, held: ReadonlySet<string>): PendingHint[] {
  const want = new Set(keys);
  return PENDING_MEMORIES.filter(m => want.has(m.key)).flatMap(m => pendingHint(m.key, held) ?? []);
}

// A log line's timestamp ("[Tue Oct 14 20:11:02 2026]") or the short one a chat window copies ("[20:11:02]").
// Any bracket that holds a clock time; a recital sentence holds no bracket at all.
const STAMP_RX = /\[[^\]\n]*\d{1,2}:\d{2}[^\]\n]*\]/g;

// Lines that are plainly not a recital sentence, so the unrecognised list is not a copy of the whole log.
const CHATTER_RX = /(?:\btells? (?:you|your|the)\b|\bsays?,|\byou say\b|\byou told\b|\bshouts?,|\bauctions?,|\bout of character\b|\byou (?:hit|slash|bash|kick|pierce|crush|punch|backstab|miss)\b|points? of damage|\bhas been (?:slain|healed)\b|\bbegin(?:s)? casting\b|\byou have gained\b|\bexperience\b)/i;
// What the Seer says around the recital, which is no flag either way.
const NOT_A_FLAG = [
  'you manage to recover some images from your childhood',
  'you have received a',
  'you receive a',
];

export type Matched = { stage: string; text: string };
export type Parsed = {
  matched: Matched[];     // one per recognised sentence, in table order; text is the sentence as pasted (capped)
  stages: string[];       // the recognised stages
  pending: string[];      // checklist memories the Seer said are waiting ('cl_grummus'): a kill, NOT a step (PENDING_MEMORIES)
  unknown: string[];      // lines that read like a sentence and matched nothing (deduplicated, capped)
  lines: number;          // non-empty lines read
};

const MAX_UNKNOWN = 25;
const MAX_TEXT = 400;

/** Read a paste: with or without timestamps, from the log, the Tells window or a copy of either. */
export function parseRecital(raw: string): Parsed {
  const text = String(raw ?? '').slice(0, 200_000);
  const lines = text.split(/\r?\n/).map(l => l.replace(STAMP_RX, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const normLines = lines.map(norm);
  // Match across the joined text so a sentence a copy wrapped onto two lines is still one sentence.
  const joined = normLines.join(' ');
  const matched: Matched[] = [];
  const seen = new Set<string>();
  const hitAt: { at: number; end: number }[] = [];
  for (const { prefix, stage } of NORMED) {
    const at = joined.indexOf(prefix);
    if (at < 0 || seen.has(stage)) continue;
    seen.add(stage);
    matched.push({ stage, text: joined.slice(at, at + MAX_TEXT) });
    hitAt.push({ at, end: at + prefix.length });
  }
  const pending: string[] = [];
  for (const { key, prefix } of PENDING_NORMED) {
    const at = joined.indexOf(prefix);
    if (at < 0 || pending.includes(key)) continue;
    pending.push(key);
    hitAt.push({ at, end: at + prefix.length });
  }
  // A line is recognised when a match starts inside it, or it carries on a sentence the line before left open
  // (a copy that wrapped a long sentence onto two lines).
  const unknown: string[] = [];
  const dup = new Set<string>();
  let pos = 0;
  let open = false;
  lines.forEach((line, i) => {
    const start = pos;
    const end = pos + normLines[i].length;
    pos = end + 1;   // the joining space
    const inSentence = open || hitAt.some(h => h.at < end && h.end > start);
    open = inSentence && !/[.!?'")\]]$/.test(line);
    const n = normLines[i];
    if (inSentence || n.length < 20 || CHATTER_RX.test(n) || NOT_A_FLAG.some(p => n.startsWith(p))) return;
    if (dup.has(n) || unknown.length >= MAX_UNKNOWN) return;
    dup.add(n);
    unknown.push(line.slice(0, 200));
  });
  return { matched, stages: matched.map(m => m.stage), pending, unknown, lines: lines.length };
}

/** Every key a set of held keys proves: what each stage implies in the catalog, and what each series value
 *  carries of the steps before it (popSteps.ts), repeated until nothing new turns up. */
export function heldClosure(keys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...keys];
  while (stack.length) {
    const k = stack.pop() as string;
    if (out.has(k)) continue;
    out.add(k);
    for (const next of STAGE_IMPLIES[k] ?? []) if (!out.has(next)) stack.push(next);
    for (const next of STEP_IMPLIES[k] ?? []) if (!out.has(next)) stack.push(next);
  }
  return out;
}

// ── Where the character stands ───────────────────────────────────────────────

export type ZoneView = {
  zone: PopNode;
  open: boolean;
  missing: string[];      // labels of the gate flags not yet held
  done: PopStep[];
  todo: PopStep[];
};

// The Seer cannot show a loot or a kill-the-avatars step, so they are never listed as next.
const UNPROVABLE = (s: PopStep) => s.how === 'loot' || s.key === 'avatars_air';

/** One view per zone card that has steps, in the chart's order. */
export function zoneViews(held: ReadonlySet<string>): ZoneView[] {
  return POP_ZONES.filter(z => (POP_STEPS[z.key] ?? []).length > 0).map(zone => {
    const steps = POP_STEPS[zone.key];
    return {
      zone,
      open: zoneAccess(zone, held as Set<string>),
      missing: zone.requires.filter(f => !held.has(f)).map(f => POP_FLAGS[f]?.label ?? f),
      done: steps.filter(s => held.has(s.key)),
      todo: steps.filter(s => !held.has(s.key) && !UNPROVABLE(s)),
    };
  });
}

// ── What a save writes ───────────────────────────────────────────────────────

export type PopFlagRow = {
  guild_id: string; character: string; flag_key: string; zone: null; boss: null;
  source: 'recital'; earned_at: string; stage: string; npc: null;
};

/** The rows a recital stores, the shape the agent's upload writes (index.js _handleAgentPopFlags): the stage
 *  itself, then each catalog flag it implies, one row per flag key, all at one time. */
export function recitalRows(guildId: string, character: string, stages: Iterable<string>, earnedAt: string): PopFlagRow[] {
  const rows: PopFlagRow[] = [];
  const seen = new Set<string>();
  const push = (flag_key: string, stage: string) => {
    if (seen.has(flag_key)) return;
    seen.add(flag_key);
    rows.push({ guild_id: guildId, character, flag_key, zone: null, boss: null, source: 'recital', earned_at: earnedAt, stage, npc: null });
  };
  for (const s of stages) {
    push(s, s);
    for (const k of STAGE_IMPLIES[s] ?? []) push(k, s);
  }
  return rows;
}
