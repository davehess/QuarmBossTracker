# Mimic 3 — voice overhaul: recorded callouts and a virtual raid leader

Hitya, 2026-08-10: *"miMIC version 3 is going to have to be an overhaul on these
TTS with voices, either recordings we have specifically for these, people saying
other peoples names would be a cool thing, virtual raid leader where we can
record our own voices saying a bunch of things and string them together. I do a
number of impressions that people have specifically asked for versions of."*

Parked as a v3 line item — this is a Mimic-scale change, not a patch.

## Where we are

Today every callout is browser `SpeechSynthesis` (`enableTriggerTts`, the same
pipeline the CH-chain "0X GO", loot-auction and slow callouts all ride). It is
serviceable and it is free, but it is one robotic voice for everything, it
mangles EQ proper nouns, and it cannot carry tone — which matters when the
difference between "rebuff" and "DEATH TOUCH INCOMING" should be audible before
the words are parsed.

## The three asks, in rising order of build cost

1. **Recorded clips for fixed callouts.** The high-frequency, fixed-string
   callouts — tank buster, death touch, enrage, rampage, "back off" — are a small
   closed set. Ship them as audio files and play the clip instead of synthesising.
   Deterministic, instant, and tone is whatever the recording has. This is the
   cheap 80%.
2. **Names spoken by other people.** Callouts that interpolate a character name
   (`RIP {victim}`, `Rampage on {target}`, CH slot calls) need a name library —
   one clip per raider name, and a clip can be recorded by *someone else*, which
   is the part Hitya wants. Concatenate `[fixed clip] + [name clip]`.
3. **Virtual raid leader.** A recorded phrase bank strung together into full
   callouts, in the guild's own voices, including impressions people have asked
   for. This is a small sequencing engine plus a recording/management UI.

## Design notes worth writing down before anyone starts

- **Concatenation is the whole problem.** Stitched clips sound wrong unless the
  seams are handled — consistent recording level, trimmed leading/trailing
  silence, and a fixed short gap. Budget for normalisation on import, not for
  asking people to record carefully.
- **Latency is the reason to do this at all, and the reason it can fail.** A clip
  plays instantly; `SpeechSynthesis` has variable startup. But a stitched
  sequence that has to load three files mid-pull is worse than the robot voice.
  Preload the whole active set at zone-in.
- **Keep the existing dispatch path.** Callouts already flow through one place
  (`_pushOverlay` with `tts`), gated by `enableTriggerTts` and, since 3.5.57, the
  per-callout mute work in `DESIGN-trigger-overlay-v2.md` §6. Voice selection
  belongs *behind* that dispatch as a renderer swap — clip if one exists, TTS
  otherwise. Do not fork the pipeline; a second path means a second set of
  mute/cooldown/suppression bugs.
- **Fall back per-callout, not globally.** Any callout with no recording must
  still speak via TTS. A half-recorded set should degrade to mixed voices, never
  to silence — silence on a death-touch callout is the worst possible failure.
- **Distribution and size.** Mimic auto-updates via electron-updater; a growing
  audio pack should NOT ride the installer or every raider re-downloads it on
  each patch. Fetch packs separately and cache — the Zeal / custom-UI-pack
  updater (`ghDownload.js`, `uiPacks.js`) is the existing precedent for
  downloading content outside the app bundle.
- **Consent is not optional.** Clips are recordings of real guild members saying
  each other's names. Someone leaving the guild, or simply asking, must be able
  to have their voice pack removed. Store who recorded what, and make removal a
  supported action rather than a file hunt. `docs/PRIVACY.md` covers log data and
  says nothing about voice — extend it before the first pack ships.
- **Impressions are a content question, not a technical one.** They are also the
  most likely thing to age badly or land wrong with someone. Keep packs opt-in
  and switchable per user, so a raider picks the voice they want to hear.

## Sequencing

Ship (1) alone first — fixed clips for the dozen callouts that matter, behind a
per-user toggle, with TTS fallback. It delivers most of the value, exercises the
preload/normalise plumbing, and proves the renderer swap before anyone records a
name library of 200 raiders.
