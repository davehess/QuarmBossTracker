// Macro suggestion catalog — MIRRORS the list in apps/mimic/ui-studio.html
// (MACRO_SUGGESTIONS). Seeded from the raid's REAL callout macros observed in
// raid chat — the same line shapes the agent's CH-chain / DA-broadcast /
// healer-mana trackers parse — plus clicky templates (incl. the bard
// stopsong → click → melody-resume pattern). Keep the two lists in sync when
// adding entries. {PLACEHOLDERS} are for the user to replace before saving;
// %T / %mana are expanded by EQ/Zeal at runtime and stay literal.

export type MacroSuggestion = {
  id: string;
  btnName: string;   // in-game social button label (EQ caps these short)
  name: string;
  who: string;
  lines: string[];
  note: string;
};

export const MACRO_SUGGESTIONS: MacroSuggestion[] = [
  { id: 'ch_num', btnName: 'CH CALL', name: 'CH call (numbered chain)', who: 'Cleric',
    lines: ['/rs {NUM} - CH - %T - Mana: %mana'],
    note: 'The numbered chain call the CH Chain overlay reads. Replace {NUM} with your slot (001, 002…). %T = your target (the tank); %mana = your mana % (Zeal).' },
  { id: 'ch_plain', btnName: 'CH INC', name: 'CH announce (unnumbered)', who: 'Cleric',
    lines: ['/rs CH < %T >   %mana mana.'],
    note: 'Unnumbered CH announce — the healer-mana tracker parses this shape too.' },
  { id: 'da', btnName: 'DA UP', name: 'DA announce (timed)', who: 'Tank / Cleric',
    lines: ['/pause 120, /rs >> DA up << 18 secs',
            '/pause 55, /rs >> DA DOWN IN 6 SECS <<',
            '/rs >> DA DOWN <<'],
    note: 'Divine Aura call — feeds the Command Center DA board. Hit it the moment DA lands. /pause is tenths of a second; tune 120/55 to your DA duration (18s shown).' },
  { id: 'tanking', btnName: 'TANKING', name: 'TANKING announce', who: 'Tank',
    lines: ['/rs TANKING - %T - HEALS FAST!'],
    note: 'Tells healers who you actually have. %T = your current target.' },
  { id: 'assist', btnName: 'ASSIST', name: 'Assist call (MA)', who: 'Main assist',
    lines: ['/rs ASSIST ME ON ~<={ %T }=>~'],
    note: 'Assist banner — fires with your current target.' },
  { id: 'assistma', btnName: 'HIT MA', name: '/assist the MA', who: 'Everyone',
    lines: ['/assist {MA}'],
    note: "Replace {MA} with your main assist's name." },
  { id: 'mana', btnName: 'MANA', name: 'Mana check-in', who: 'Healers / casters',
    lines: ['/rs %mana - {CLASS}'],
    note: 'Feeds the Command Center healer-mana board. Replace {CLASS}; %mana = Zeal.' },
  { id: 'slow', btnName: 'SLOWED', name: 'Slow landed', who: 'Shaman',
    lines: ['/rs %T is Shaman Slowed 75%'],
    note: 'Slow announce — tune the % to the slow you actually landed.' },
  { id: 'inc', btnName: 'INC', name: 'Incoming pull', who: 'Puller',
    lines: ['/rs Incoming < %T >'],
    note: 'Incoming call for pulls.' },
  { id: 'clicky', btnName: 'CLICKY', name: 'Clicky item', who: 'Anyone',
    lines: ['/useitem {SLOT}'],
    note: 'Zeal /useitem clicks the item in slot {SLOT}. Chain several clickies with /pause between lines (tenths of a second — cover each cast time).' },
  { id: 'bardclick', btnName: 'BRD CLICK', name: 'Bard clicky (stopsong → click → melody)', who: 'Bard',
    lines: ['/pause 3, /stopsong',
            '/pause 30, /useitem {SLOT}',
            '/melody {GEMS}'],
    note: 'Stops your song, clicks {SLOT} (the /pause 30 = 3s covers the click cast — tune to the item), then resumes /melody {GEMS} (e.g. 1 2 3 4).' },
];
