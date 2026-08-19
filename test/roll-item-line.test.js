// test/roll-item-line.test.js — naming the item a /random range is for.
//
// Hitya, 2026-08-14: "These rolls didn't get consolidated to loot in the
// website but did on here" — eleven roll sessions on the /rolls page, every one
// of them "unlabeled roll" with an empty LOOTED BY column, while the Command
// Center showed the same four ranges live.
//
// The cause was one line in the agent:
//
//     if (!line || line.indexOf('|') === -1) return;
//
// The roll caller had used commas:
//
//     [G] [Canopy]: Black Tear 111 , Platinum Tear 222 , Poison Tear 333, Runed Tear 444
//
// so no label was ever captured, and because attributeLoot() early-returns on a
// null item, the missing NAME is also what emptied the LOOTED BY column. One
// dropped separator took out both halves of the page.
//
// Every line below is a REAL one, read out of chat_messages. That matters more
// than usual here: the parser now looks at ordinary chat instead of only at
// lines carrying a `|`, so the negatives are the point of this file — a comma
// is not proof of intent the way a pipe was, and the guards only earn their
// keep if the chatter that would trip them is in the suite.
//
// Run: npx vitest run test/roll-item-line.test.js

import { describe, it, expect } from 'vitest';
import { parseRollItemLine } from '../packages/wolfpack-logsync/index.js';

const byNum = (text) => {
  const out = {};
  for (const e of parseRollItemLine(text)) out[e.num] = e.item;
  return out;
};

describe('shape A — pipe-separated (the shape that already worked)', () => {
  it('reads a six-item link line', () => {
    expect(byNum(
      "Choker of the Wretched 111 | Crown of Narandi 222 | Earring of the Frozen Skull 333 | "
      + "Eye of Narandi 444 | Faceguard of Bentos the Hero 555 | Narandi's Lance 666",
    )).toEqual({
      111: 'Choker of the Wretched',
      222: 'Crown of Narandi',
      333: 'Earring of the Frozen Skull',
      444: 'Eye of Narandi',
      555: 'Faceguard of Bentos the Hero',
      666: "Narandi's Lance",
    });
  });

  it('reads the number jammed against the item, which is how EQ links paste', () => {
    // "Black Tear 111| Emerald Tear222 | …" — spacing is whatever the caller's
    // client produced; it is not a signal.
    expect(byNum('Black Tear 111| Emerald Tear222 | Ruby Tear333 | Silver Tear444 | White Tear555'))
      .toEqual({ 111: 'Black Tear', 222: 'Emerald Tear', 333: 'Ruby Tear', 444: 'Silver Tear', 555: 'White Tear' });
  });

  it('keeps (qty) with the number, not the item name', () => {
    const got = parseRollItemLine('Kavruul`s Mystic Pouch (2) 222');
    expect(got).toEqual([{ num: 222, item: 'Kavruul`s Mystic Pouch', qty: 2 }]);
  });

  it('ignores link segments with no roll number', () => {
    // Half of a real line is items nobody is rolling on yet.
    expect(byNum('Crystalline Spear 111| Kavruul`s Mystic Pouch (2) 222| Torn, Frost covered book | White Dragon Scales'))
      .toEqual({ 111: 'Crystalline Spear', 222: 'Kavruul`s Mystic Pouch' });
  });

  it('does not glue a numberless item onto the next one', () => {
    // Caught by sweeping the parser over real chat, NOT by the fixtures above:
    // rewriting the separator-split as a number-walk made "Golden Ember Powder |
    // Unadorned Plate Boots 444" come out as one 40-character item. A separator
    // ENDS an item — only the text after the last one names this number.
    expect(byNum('Golden Ember Powder | Unadorned Plate Boots 444'))
      .toEqual({ 444: 'Unadorned Plate Boots' });
    expect(byNum('Pod of Seawater | Sea Dragon Meat111 Treasure Hunter`s Satchel (2)222 | Water Dragon Meat333'))
      .toEqual({ 111: 'Sea Dragon Meat', 222: 'Treasure Hunter`s Satchel', 333: 'Water Dragon Meat' });
  });
});

describe('shape B — comma-separated (the reported bug)', () => {
  it('reads Canopy\'s four Tears, the line that started this', () => {
    expect(byNum('Black Tear 111 , Platinum Tear 222 , Poison Tear 333, Runed Tear 444'))
      .toEqual({ 111: 'Black Tear', 222: 'Platinum Tear', 333: 'Poison Tear', 444: 'Runed Tear' });
  });

  it('does not care that the spacing around the commas is inconsistent', () => {
    // The captured line has "111 ," and "333," — a caller typing fast.
    const spaced = byNum('Black Tear 111 , Platinum Tear 222');
    const tight  = byNum('Black Tear 111,Platinum Tear 222');
    expect(spaced).toEqual(tight);
  });
});

describe('shape C — one item, several ranges by priority tier', () => {
  // The most common shape in our chat, and it was dropped entirely. Every range
  // names the SAME item; what changes is who may roll.
  it('carries the item across tier ranges', () => {
    expect(byNum('Helmet of Shadow 311 pick, 322 upgrade, 333 alt'))
      .toEqual({ 311: 'Helmet of Shadow', 322: 'Helmet of Shadow', 333: 'Helmet of Shadow' });
  });

  it('handles the two-tier form', () => {
    expect(byNum("Elder Spiritist's Breastplate 911 upgrade, 922 greed"))
      .toEqual({ 911: "Elder Spiritist's Breastplate", 922: "Elder Spiritist's Breastplate" });
  });

  it('handles a tier written without a comma', () => {
    expect(byNum('Corroded Plate Boots 111 upgrade 122 alt'))
      .toEqual({ 111: 'Corroded Plate Boots', 122: 'Corroded Plate Boots' });
  });

  it('handles a capitalised tier word, which looks exactly like an item', () => {
    // "222 Upgrade, 244 alt" — capitalisation is why the tier LIST exists and
    // the Title-Case rule alone is not enough.
    expect(byNum('Head of Staff Sergeant Drioc 222 Upgrade, 244 alt'))
      .toEqual({ 222: 'Head of Staff Sergeant Drioc', 244: 'Head of Staff Sergeant Drioc' });
  });

  it('handles a multi-word tier', () => {
    expect(byNum('Tolapumj s Robe 311 upgrade kit, 322 greed'))
      .toEqual({ 311: 'Tolapumj s Robe', 322: 'Tolapumj s Robe' });
  });

  it('strips a tier stuck to the END of an item name', () => {
    // Two items on one line, each followed by "greed".
    expect(byNum('Ran 444 Slime Blood of Cazic Thule greed 555 Shield of Rainbow Hues greed pst if u truely need'))
      .toMatchObject({ 555: 'Slime Blood of Cazic Thule' });
  });

  it('keeps an item name that merely CONTAINS a tier word', () => {
    // "Ring of the Second Sight" must not be eaten down to "Ring of the".
    expect(byNum('Ring of the Second Sight 111')).toEqual({ 111: 'Ring of the Second Sight' });
  });
});

describe('what it must NOT label', () => {
  // These are the lines that make widening past `|` a real risk. Each one was
  // captured within minutes of a live roll set, so a false label here would have
  // shown up on the /rolls page as fact.

  it('refuses a percentage — a CH callout is not a roll call', () => {
    // A 0-100 roll set existed the same night, so "100" here would have landed.
    expect(parseRollItemLine('CH inc to -== [ Hawkner ] ==- I like pie.  ( Mana: 100% )')).toEqual([]);
  });

  it('refuses dice chatter', () => {
    expect(parseRollItemLine('Mouth refreshes on a roll of 6 on 1d , butt refreshes on 1.')).toEqual([]);
    expect(parseRollItemLine('mouth refreshes on a roll of 6 on 1d6, butt refreshes on 1.')).toEqual([]);
  });

  it('refuses lowercase chatter around a number', () => {
    // "911 pullers kiters, 922 for key fetishes" — no item named at all.
    expect(parseRollItemLine('911 pullers kiters, 922 for key fetishes')).toEqual([]);
  });

  it('labels the item but not the chatter after it', () => {
    // Same call WITH the item — 922's segment is "pullers kiters", which is
    // chatter, so it carries Palace Key rather than inventing an item.
    expect(byNum('Palace Key 911 pullers kiters, 922 for key fetishes'))
      .toEqual({ 911: 'Palace Key', 922: 'Palace Key' });
  });

  it('refuses a bare number with nothing around it', () => {
    expect(parseRollItemLine('111')).toEqual([]);
    expect(parseRollItemLine('222')).toEqual([]);
  });

  it('refuses times, decimals and long numbers', () => {
    expect(parseRollItemLine('Pull in 30 seconds')).toEqual([]);       // lowercase tail, no item
    expect(parseRollItemLine('Aten Ha Ra in 604s')).toEqual([]);       // trailing letter, still chatter
    expect(parseRollItemLine('We did 12345678 damage')).toEqual([]);
  });

  it('refuses a sentence that happens to contain a range', () => {
    // Both captured within 20 minutes of a live 0-100 roll set, so both would
    // have landed on the /rolls page as the item that set was for.
    expect(parseRollItemLine('I think we were randoming 100.  Hawkner got a 22 I think?')).toEqual([]);
    expect(parseRollItemLine("You didn't even bid 100. Doubt!")).toEqual([]);
  });

  it('refuses raid shorthand, which is ALL CAPS and short', () => {
    // "DI - Guts 100" — a Divine Intervention callout with the target's mana,
    // minutes from a real 0-100 set. No EQ item name opens with DI/CH/MT/OT.
    expect(parseRollItemLine('DI - Guts 100 )')).toEqual([]);
  });

  it('refuses a phrase with no real word in it', () => {
    // "Do a 777 if you want a Shield of the Immaculate" — the item is named
    // AFTER the number, mid-sentence, so the only thing in front of 777 is
    // "Do a". Labelling that would be worse than leaving it unlabelled.
    expect(parseRollItemLine('Do a 777 if you want a Shield of the Immaculate')).toEqual([]);
  });

  it('is empty for an empty or junk body', () => {
    expect(parseRollItemLine('')).toEqual([]);
    expect(parseRollItemLine(null)).toEqual([]);
    expect(parseRollItemLine('hey')).toEqual([]);
  });
});

describe('shape D — one item, no separator at all (the most common of all)', () => {
  // 45 days of chat says the single-item call is what people mostly type. None
  // of these carried a `|`, so every one of them was dropped.
  it('reads a bare "<Item> <range>" call', () => {
    for (const [text, num, item] of [
      ['Atramentous Shield 333', 333, 'Atramentous Shield'],
      ['Mace of the Shadowed Soul 777', 777, 'Mace of the Shadowed Soul'],
      ['Wand of Allure 222', 222, 'Wand of Allure'],
      ['Puppet Strings 555', 555, 'Puppet Strings'],
      ['Talisman of the Burrower 111', 111, 'Talisman of the Burrower'],
      ['Unadorned Plate Gauntlets 111', 111, 'Unadorned Plate Gauntlets'],
      ['Lost Staff of the Scorned 444', 444, 'Lost Staff of the Scorned'],
    ]) {
      expect(byNum(text), text).toEqual({ [num]: item });
    }
  });

  it('keeps a lowercase "of"/"the" from dragging the name down', () => {
    expect(byNum('Section of Lodizal\'s Shell 333')).toEqual({ 333: "Section of Lodizal's Shell" });
  });

  it('drops a dangling dash before the range', () => {
    expect(byNum('Shadow Tendril - 111 pick, 122 upgrade, 133 alts'))
      .toEqual({ 111: 'Shadow Tendril', 122: 'Shadow Tendril', 133: 'Shadow Tendril' });
  });
});

describe('the number-first form', () => {
  it('reads an item named AFTER its number', () => {
    expect(byNum('222 for White Silken Bridle')).toEqual({ 222: 'White Silken Bridle' });
  });

  it('only ever looks forward at the HEAD of a line', () => {
    // The trap: mid-line, the text after a number belongs to the NEXT number.
    // Reading forward there would label every item one place off — 111 would
    // become "Platinum Tear". The head-only rule is what prevents that.
    expect(byNum('Black Tear 111 , Platinum Tear 222'))
      .toEqual({ 111: 'Black Tear', 222: 'Platinum Tear' });
  });

  it('does not look forward when the line already named items', () => {
    const got = byNum('Palace Key 911 pullers kiters, 922 for key fetishes');
    expect(got[911]).toBe('Palace Key');
    expect(Object.values(got)).not.toContain('key fetishes');
  });
});
