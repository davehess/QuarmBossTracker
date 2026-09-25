// Quests and inventory get separate sharing switches (the guild lead,
// 2026-09-25: "we should separate out inventory versus quests"). One flag,
// show_inventory_publicly, used to open the quests, inventory and spellbook
// pages together behind a toggle labelled "Quests: public".
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const src = (p) => stripJs(fs.readFileSync(path.join(ROOT, 'web', p), 'utf8'));
const quests    = src('app/character/[name]/quests/page.tsx');
const inventory = src('app/character/[name]/inventory/page.tsx');
const spells    = src('app/character/[name]/spells/page.tsx');
const toggles   = src('app/me/ExclusionToggles.tsx');
const actions   = src('app/me/actions.ts');
const me        = src('app/me/page.tsx');

describe('the quest page has its own switch', () => {
  it('visitors need show_quests_publicly; inventory and spellbook keep show_inventory_publicly', () => {
    expect(quests).toContain('if (!officer && !isOwner && !char.show_quests_publicly) {');
    expect(quests).not.toContain('if (!officer && !isOwner && !char.show_inventory_publicly) {');
    expect(inventory).toContain('if (!officer && !isOwner && !char.show_inventory_publicly) {');
    expect(spells).toContain('if (!officer && !isOwner && !char.show_inventory_publicly) {');
    expect(quests).toMatch(/\.select\('name, class, race, main_name, discord_id, show_inventory_publicly, show_quests_publicly'\)/);
  });

  it('a shared quest page with a private inventory hides the inventory listings', () => {
    expect(quests).toContain('const showInvDetail = officer || isOwner || !!char.show_inventory_publicly;');
    // Key evidence names, discovery, stack turn-ins, turn-in rewards held,
    // hidden/dismissed, the two "probably don't need" lists, broken items.
    expect(quests).toMatch(/\{showInvDetail && <> — \{k\.evidence_items/);
    expect(quests).toContain('{showInvDetail && (discoveryCount > 0 ||');
    expect(quests).toMatch(/\{showInvDetail && \(\s*<section className="bg-panel border border-border rounded-lg p-5">\s*<h3 className="text-lg text-orange mb-2">Stack turn-ins/);
    expect(quests).toContain('{showInvDetail && completedTurninItems.length > 0 && (');
    expect(quests).toContain('{showInvDetail && (hiddenProgress.length > 0 ||');
    expect(quests).toMatch(/\{showInvDetail && \(<>\s*<section className="bg-panel border border-border rounded-lg p-5">\s*<h3 className="text-lg text-orange mb-2">Quest pieces you probably/);
    expect(quests).toContain('{showInvDetail && brokenItems.length > 0 && (');
  });
});

describe('/me', () => {
  it('two sharing toggles, each writing its own column', () => {
    expect(toggles).toMatch(/flip\('show_quests_publicly', next, setShowQuests, showQuests\)/);
    expect(toggles).toMatch(/flip\('show_inventory_publicly', next, setShowInv, showInv\)/);
    expect(toggles).toContain('onLabel="Quest page: PUBLIC"');
    expect(toggles).toContain('onLabel="Inventory page: PUBLIC"');
    expect(toggles).not.toContain('Quests: PUBLIC');
  });

  it('the server action accepts the new column, and /me reads and passes it', () => {
    expect(actions).toMatch(/const allowed: FlagKey\[\] = \[[^\]]*'show_quests_publicly'/);
    expect(me).toMatch(/show_inventory_publicly, show_quests_publicly'\)/);
    expect(me.match(/showQuestsPublicly=\{!!c\.show_quests_publicly\}/g) || []).toHaveLength(2);
  });
});
