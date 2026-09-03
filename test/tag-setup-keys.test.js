// test/tag-setup-keys.test.js — "Set up EQ for me" configures tagging, and the
// password never touches source.
//
// Hitya, 2026-09-03, with a working zeal.ini: "we're going to add some pieces
// for setup for tagging... we want tooltip and tag enabled".
//
// Two of the keys are REQUIRED for capture at all, from Zeal's source:
// NameplateTagSuppress=FALSE (else PrintChat skips the log write) and
// NameplateTagPrettyPrint=FALSE (else, with Filter on, the spawn id is
// destroyed at the source). Everything else is Hitya's working config.
//
// Run: npx vitest run test/tag-setup-keys.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const { _EQ_SETUP_KEYS } = evalBlock(
  sliceBlock(src, 'const _EQ_SETUP_KEYS = [', '\n// ── /tag channel autojoin '),
  ['_EQ_SETUP_KEYS'],
);
const zeal = Object.fromEntries(_EQ_SETUP_KEYS.filter(k => k[0] === 'zeal.ini' && k[1] === 'Zeal').map(k => [k[2], k[3]]));

describe('the zeal.ini keys the setup writes', () => {
  it('turns tagging and the tooltip on — the ask', () => {
    expect(zeal.NameplateTagEnable).toBe('TRUE');
    expect(zeal.NameplateTagToolTip).toBe('TRUE');
    expect(zeal.NameplateTagToolTipAlign).toBe('TRUE');
    expect(zeal.NameplateTagFilter).toBe('TRUE');
    expect(zeal.NameplateRaidHealthBars).toBe('TRUE');
  });

  it('turns OFF the two settings that silently kill capture', () => {
    // Suppress on → nothing is ever logged. Prettyprint on (with Filter) →
    // the spawn id is stripped at the source. Either one flipped to TRUE here
    // and every raider who clicks Set Up stops contributing, invisibly.
    expect(zeal.NameplateTagSuppress).toBe('FALSE');
    expect(zeal.NameplateTagPrettyPrint).toBe('FALSE');
  });

  it('points at the guild channel by NAME', () => {
    expect(zeal.NameplateTagChannel).toBe('Ztwolfpacktag');
  });

  it('does not touch base nameplate display keys', () => {
    // Unverified dependency + a raider's own display preference. The card
    // says "check nameplates" instead of flipping them.
    for (const k of ['NameplateColors', 'NameplateHealthBars', 'NameplateManaBars', 'NameplateConColors', 'NameplateTargetColor']) {
      expect(zeal[k], k).toBeUndefined();
    }
  });

  it('keeps the original four setup keys intact', () => {
    expect(zeal.ExportOnCamp).toBe('TRUE');
    expect(zeal.PipeDelay).toBe('100');
    expect(zeal.PipeVerbose).toBe('TRUE');
    expect(_EQ_SETUP_KEYS.some(k => k[0] === 'eqclient.ini' && k[2] === 'Log' && k[3] === 'TRUE')).toBe(true);
  });
});

describe('the join specs come from tuning, never from source', () => {
  // Contract (2026-09-03): the bot serves RESOLVED full "name:password" specs —
  // tag_channel_spec and officer_channel_spec — from env by default, tuning
  // override first. The agent carries no policy and no secret of its own. The
  // earlier tag_channel_password/tag_officer_channel keys are gone.
  function load(tuning, identity) {
    return evalBlock(
      `const _overlayTuning = ${JSON.stringify(tuning)}; const _mimicIdentity = ${JSON.stringify(identity)};\n`
      + sliceBlock(src, "const TAG_CHANNEL_NAME = 'Ztwolfpacktag';", '\n// Merge `spec` into an existing autojoin list.'),
      ['_tagChannelSpecs'],
    );
  }

  it('passes the raid spec through when it names our channel', () => {
    expect(load({ tag_channel_spec: 'Ztwolfpacktag:secret' }, null)._tagChannelSpecs().raid).toBe('Ztwolfpacktag:secret');
  });

  it('is null — not a guess — until the bot has a value', () => {
    expect(load({}, null)._tagChannelSpecs().raid).toBeNull();
  });

  it('only hands the officer channel to an officer', () => {
    const t = { tag_channel_spec: 'Ztwolfpacktag:x', officer_channel_spec: 'Off:pw' };
    expect(load(t, { is_officer: true })._tagChannelSpecs().officer).toBe('Off:pw');
    expect(load(t, { is_officer: false })._tagChannelSpecs().officer).toBeNull();
    expect(load(t, null)._tagChannelSpecs().officer).toBeNull();
  });

  it('the agent source contains no password, and the dashboard card takes it at render time', () => {
    // Comments stripped: a comment quoting the password would be exactly as
    // bad as code doing it, and would satisfy a naive toContain.
    // ⚠ The invariant is "no name:password LITERAL", not "no colon after the
    // name". The agent legitimately contains `tells\s+Wolfpackofficer:` — the
    // privacy filter for the officer channel's chat-line prefix — and a first
    // draft of this assertion flagged it. Requiring a password character right
    // after the colon is what separates chat syntax from a leaked secret.
    const clean = stripJs(src);
    expect(clean).not.toMatch(/ztwolfpacktag:[A-Za-z0-9]/i);
    expect(clean).not.toMatch(/wolfpackofficer:[A-Za-z0-9]/i);
    expect(clean).toMatch(/zealTagJoin: _tagChannelSpecs\(\)/);
  });
});
