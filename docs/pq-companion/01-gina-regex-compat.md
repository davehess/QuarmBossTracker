# GINA / EQLogParser trigger-regex compatibility — pq-companion vs. Wolfpack

**Scope.** Everything under `.../scratchpad/pq-companion` was read as *untrusted data*.
No pq-companion code is reproduced here beyond short quoted excerpts for analysis;
every code block in §4 is original, written for `packages/wolfpack-logsync/index.js`.

**Method.** Beyond reading both codebases, I ran our three live translation functions
(`_translateDotNetRegex`, `_translateGinaPlaceholders`, `_expandTemplate` — transcribed
verbatim) against **1,189 real triggers** from pq-companion's import fixtures
(4 GINA `.gtp` packs = 946 triggers, 1 EQLogParser `.tgf` = 243 triggers), and then re-ran
the same corpus against the proposed replacement pipeline. Harnesses:
`scratchpad/pq-analysis/verify.js`, `survey.js`, `proto.js`.

### Headline numbers (583 regex-mode triggers in the corpus)

| Measure | Our engine today | Proposed (§4) |
|---|---|---|
| Patterns that compile at all | 491 (92 throw `Invalid group`) | **583** |
| Patterns that can ever match a live line | ≤ 272 (311 are `^`-anchored and dead) | **583** |
| Action texts our expander can resolve | 0 of 237 foreign-token texts | **237** |
| `{n}/{N}` numeric tokens honoured | 0 of 17 | 17 |
| `{c}/{C}` bound to your character | 0 of 11 (all become wildcards) | 11 |

For contrast: RE2 makes pq-companion reject **95** of the same 583 (94 lookaround,
1 backreference) — they import those disabled. JavaScript compiles and runs all 95.
**We have the better regex engine and the worse pipeline around it.**

---

## 1. How pq-companion does it

### 1.1 Where matching actually runs — Go, not the frontend

Matching is 100 % Go/RE2. `frontend/src/lib/triggerRegex.ts:17-33` exists **only** to
give the editor form immediate validation feedback; its header comment says so outright
("Trigger patterns are matched by the Go backend (RE2 via `regexp.Compile`)"). It performs
two JS-ward translations (`(?P<` → `(?<`, leading inline flags → a RegExp flags argument)
purely so a *valid backend pattern* isn't falsely flagged in the browser. Consumers:
`CreateTriggerModal.tsx:140-147` and `pages/TriggersPage.tsx:518`.

Real matching:
- compile — `backend/internal/trigger/engine.go:177` `regexp.Compile(normalizePattern(t.Pattern, character))`,
  plus `:187` (extra patterns), `:195` (worn-off), `:208` (exclude patterns).
- match — `engine.go:247` `c.re.FindStringSubmatch(message)` inside `Handle(timestamp, message)`.

### 1.2 Lines are timestamp-stripped **before** the engine sees them ⭐

`engine.go:226-229`:
> *"Handle tests a raw log line message against all enabled triggers. timestamp is when
> the line was logged; **message is the text after the EQ timestamp prefix** (i.e. the bare
> log message, without brackets)."*

The strip is in `backend/internal/logparser/parser.go:317-326` — a fixed-width
`[Mon Jan _2 15:04:05 2006]` (26 chars) slice, `line[tsLen+1:]` — and the caller is
`backend/cmd/server/main.go:1462` `triggerEngine.Handle(ts, msg)`. **This is the single
most important structural difference** (see §3.1).

### 1.3 Import pipeline

```
POST /api/triggers/import/preview  (api/triggers.go:509-531, 128 MiB cap)
  └─ trigger.DetectAndParse(filename, bytes)          importer.go:81-126
       ├─ PKZIP magic 50 4B 03 04 ─> unwrapZip        importer.go:132-184
       │    picks ShareData.xml, else a *trigger*.json, else any .json;
       │    128 MiB member cap, depth-4 zip-in-zip guard; recurses
       ├─ first non-space byte '<' ─> parseGINAImport  gina.go:53-92
       └─ first non-space byte '{' or '[' ─> parseJSONImport importer.go:188-198
            ├─ contains "capturePhrases"  -> EQNag      importer_eqnag.go
            ├─ contains "TriggerData"     -> EQLogParser importer_eqlogparser.go:47-80
            └─ contains "pack_name"       -> own format  importer.go:203-224
  ─> ImportPreview{Format, SourceName, Triggers[]{Trigger, OriginalGroup, Warnings, RegexOK}}
      NOTHING persisted. Wizard (ImportTriggersModal.tsx) shows per-trigger warnings +
      a "regex" badge on regex_ok=false rows, user selects a subset.
POST /api/triggers/import/commit   (api/triggers.go:545-636)
      re-validates every pattern server-side (:593) — "a hand-built commit request
      (bypassing the wizard) could otherwise install a trigger ... that silently never
      fires while still showing as enabled" — all-or-nothing InsertMany, then Reload().
```

Both parsers walk the *folder tree* and keep the slash-joined path as `OriginalGroup`
(`gina.go:60-85` recursive `walk`; `importer_eqlogparser.go:54-73`), so the wizard can show
where a trigger lived in the source app.

Non-regex source patterns are `regexp.QuoteMeta`'d, not passed through
(`gina.go:105-107`, `importer_eqlogparser.go:98-100` — *"so spell names like
'Words of Acquisition (Beza)' don't become regex groups"*).

Every imported pattern is validated and, on failure, **imported disabled with a warning**
rather than silently dead — `gina.go:173-177`, `importer_eqlogparser.go:188-192`,
`importer.go:263-278`:

> `"pattern doesn't compile under RE2 — imported disabled, edit it in-app"`

### 1.4 Token table — exact expansions

**A. Pattern tokens** — `normalizePattern(pattern, character)`, `engine.go:499-532`,
gated by `patternTokenRe = \{([A-Za-z][A-Za-z0-9_]*)\}` (`engine.go:497`).
The alpha-first requirement is deliberate: *"Repetition syntax like `\d{2}` contains no
letters so it never matches."*

| Token | Expansion | Notes |
|---|---|---|
| `{c}` `{C}` `{char}` `{CHAR}` `{self}` | `regexp.QuoteMeta(activeCharacter)` | case-insensitive match on the key; **left as the literal token when no character is known yet** (`:517-519`), and `Reload()` re-compiles on character change (`engine.go:153-159`) |
| `{S}` `{s}` | `(?P<S>.+)` | greedy |
| `{S1}`…`{S9}` (any case) | `(?P<S1>.+)` … | group name = uppercased token |
| `{N}` `{n}` | `(?P<N>[0-9]+)` | |
| `{N1}`…`{N9}` (any case) | `(?P<N1>[0-9]+)` … | |
| `{S10}`, `{spell}`, `{2,3}`, `{3,14}` | **untouched** | test-asserted at `engine_test.go:923` |
| `(?<name>…)` | `(?P<name>…)` | `dotnetNamedGroupRe = \(\?<([A-Za-z][A-Za-z0-9_]*)>` — deliberately alpha-first so `(?<=` / `(?<!` lookbehind falls through and produces an honest RE2 error (`engine.go:488-492`) |

Applied to: primary pattern, extra patterns, worn-off pattern, exclude patterns —
all four call sites in `Reload()`.

**B. Action-text tokens** — `substituteCaptures(template, match, names, builtins)`,
`engine.go:534-594`, driven by `curlyCaptureRe = \{([A-Za-z0-9_]+)\}` and
`dollarCaptureRe = \$(\d+)` (`engine.go:483-486`).

| Reference | Resolves to |
|---|---|
| `{0}` / `$0` | the whole matched line |
| `{1}`…`{9}` / `$1`…`$9` | numbered submatch |
| `{name}` | named group |
| `{S}` / `{s}` | **alias for group 1** when no literal group of that name exists (`:562-575`) |
| `{S1}`…`{S9}` / `{s1}`… | alias for group *N* |
| `{c}` `{char}` `{self}` (any case) | active character built-in |
| `{target}` `{t}` (any case) | current combat target built-in |
| anything unresolved | **left verbatim** — so literal braces survive |

Explicit capture groups shadow built-ins (`engine.go:546`, asserted `engine_test.go:905-908`).
Built-ins resolve even with no regex match, which is how pipe-source triggers get `{c}`
(`engine.go:430-442`). Same substitution runs over timer-alert TTS templates
(`marshalTimerAlerts`, `engine.go:603-617`).

**C. Import-time rewrite** — `normalizeActionText`, `importer.go:226-240`:
`dollarBraceRe = \$\{([A-Za-z0-9_]+)\}` → `{$1}`. GINA writes `${2}`, `${seller}`,
`${item}`; this converts them to the engine's native `{2}` / `{seller}` form
*"so the runtime engine ... substitutes them without any hot-path change."*
Applied to `DisplayText` and `TextToVoiceText` (`gina.go:114,122`).

**D. EQLogParser-specific rewrite** — `eqlpText`, `importer_eqlogparser.go:205-210`:
`{L}` (whole line) → `{0}`.

**E. Timer-key token** — `eqlpFirstCaptureGroup`, `importer_eqlogparser.go:216-228`:
EQLP's `AltTimerName` (e.g. `"Enraged: {s1}"`) is mined for its first token, uppercased to
match `normalizePattern`'s group naming (`S1`), and stored as
`TimerKeyCapture` + `TimerTargetCapture` — turning one trigger into per-mob timer rows
("`<name>` on `<mob>`"). Resolved at fire time by `resolveTimerKey`/`resolveTimerTarget`
(`engine.go:846-875`).

### 1.5 Field mapping (source app → their model)

GINA (`gina.go:97-180`):

| GINA XML | → |
|---|---|
| `Name` / `TriggerText` / `EnableRegex` | Name / Pattern / QuoteMeta-if-false |
| `UseText` + `DisplayText` | `overlay_text` action (5 s, `#ffffff`) — **both** gates checked |
| `UseTextToVoice` + `TextToVoiceText` | `text_to_speech` action |
| `TimerType` ∈ {Timer, RepeatingTimer} | `TimerTypeDetrimental` |
| `TimerDuration` / `TimerMillisecondDuration` | `TimerDurationSecs` via `ginaDurationSecs` (`:194-222`) — handles bare seconds, floats, `HH:MM:SS`, and the ms field |
| `TimerEndingTrigger`, else `TimerEarlyEnders/EarlyEnder[]` | `WornOffPattern`, the enders joined as `(?:a)\|(?:b)` with per-ender `EnableRegex` honoured (`:138-153`) |
| `PlayMediaFile` (a bare bool — no filename in the export) | `applySoundFallback` (`importer.go:291-318`): if the trigger already alerts visually/audibly, **drop with a warning**; else **synthesise a TTS action** speaking the display text or trigger name |

EQLogParser (`importer_eqlogparser.go:83-200`): `Pattern`/`UseRegex`, `TextToDisplay`,
`TextToSpeak`, `DurationSeconds`+`EnableTimer`+`TimerType`, `AltTimerName`,
**`EndEarlyPattern` *and* `EndEarlyPattern2` with their own `EndUseRegex`/`EndUseRegex2`
flags** joined into an alternation (`:139-158`), `WarningSeconds`+`WarningTextToSpeak` →
a `TimerAlert` threshold, `LockoutTime` → `RefireCooldownSecs`, `SoundToPlay` → the same
sound fallback. Things they can't map produce explicit warnings rather than silence:
`PreviousPattern` ("previous-line condition dropped"), `EndEarlyTextToSpeak`/`EndTextToSpeak`,
`TextToSendToChat`/`ChatWebhook`.

### 1.6 RE2 bridging

They do **not** bridge .NET's advanced constructs — RE2 cannot. Instead:
1. `(?<name>` → `(?P<name>` is the one rewrite (`engine.go:512`).
2. Anything else that fails compiles to an error, and the trigger is imported **disabled + flagged**.
3. They added a *product* workaround for the missing lookbehind: `ExcludePatterns`
   (`engine.go:64-67`) — *"Lets a broad pattern (e.g. 'incoming tell') filter pet/merchant
   lines without needing RE2 lookbehind."*
4. Their own 40+ built-in packs (`packs.go`) never use GINA tokens at all — raw
   `^(?:…|[A-Z][a-zA-Z']{2,14}…)$` regex. The token machinery exists *purely* for imports.

---

## 2. How we do it

### 2.1 Two different token tables in two different places

| | function | where used |
|---|---|---|
| **Import-time** | `_translateGinaPlaceholders` — `packages/wolfpack-logsync/index.js:26954-26961` | *only* the local import endpoint: `:20889` (pattern) and `:20904` (end-early) |
| **Compile-time** | `_translateDotNetRegex` — `:25833-25855` | guild triggers `:26524`, personal triggers `:26666`, end-early `:26684`, `/api/triggers/test` `:20938` |

`_translateGinaPlaceholders` (quoted for analysis, 6 lines):
```js
.replace(/\{[sS](\d+)\}/g, '(?<s$1>.+?)')
.replace(/\{[nN](\d+)\}/g, '(?<n$1>\\d+)')
.replace(/\{[sS]\}/g,      '(.+?)')
.replace(/\{[nN]\}/g,      '(\\d+)')
```

`_translateDotNetRegex` (quoted for analysis):
```js
p = p.replace(/\(\?>/g, '(?:');
let sIdx = 0;
p = p.replace(/\{[sScC]\d*\}/g, () => {
  const name = sIdx === 0 ? 's' : `s${sIdx}`;
  sIdx++;
  return `(?<${name}>[\\w'\` -]+?)`;
});
```

The two disagree on `{s1}` naming, on the `{s}` character class, on whether `{n}` exists,
and on what `{c}` means.

### 2.2 Compile → match → act

- **Guild** — bot `index.js:8012-8052` (`_handleAgentGuildTriggers`) selects `guild_triggers`
  rows and returns them **verbatim** (no normalisation server-side); agent
  `_applyGuildTriggersResponse` `:26510-26534` compiles `new RegExp(_translateDotNetRegex(pattern), flags||'i')`.
- **Personal** — `personal_triggers.json` next to `logsync.stats.json`;
  `loadPersonalTriggers` `:26591-26618`, `savePersonalTriggers` (atomic `.tmp`+rename) `:26623-26641`,
  `_compilePersonalTrigger` `:26656-26670`, `_compileEndEarlyRegex` `:26678-26690`.
  Empty pattern ⇒ `_regex = null` (pure-Zeal gauge triggers).
- **Import** — `POST /api/personal-triggers/import` `:20848-20919`; dispatch by first char
  (`/^\s*[\[{]/` ⇒ `_parseTriggerTgfJson` `:26910-26946`, else `_parseTriggerXml` `:26865-26901`);
  duplicates skipped by lowercased name; browser-side file reader `:18477-18499` gunzips
  `.tgf.gz` via `DecompressionStream('gzip')`.
- **Match** — `evaluateTriggersAgainstLine(line, tsMs)` `:30061-30127`, called from the
  tail loop at `:31926-31928` with the **raw line, timestamp prefix included**
  (`parseEqTimestamp(line)` on the same variable at `:31920`; every sibling parser in the
  file uses a `\]\s+` prefix, and `:25915-25916` documents *"patterns here match the RAW
  line, so a bare `^` would anchor before `[Tue Aug…` and never fire (the #190 trap)"*).
  Order: end-early cancel → `_regex.exec` → charm-pet suppression
  (`_captureMatchesCharmPet` `:25860-25872`, keys matching `/^s\d*$/`) → cooldown → fire.
- **Act** — `_fireTriggerActions` `:30232+`. Action text goes through `_expandTemplate`
  `:29907-29913`, which is *only*:
  ```js
  template.replace(/\{(\w+)\}/g, (_, k) =>
    (captures && captures[k] != null) ? String(captures[k]) : `{${k}}`)
  ```
  fed **`m.groups` only** (`:30109`) — no numbered groups, no whole line, no built-ins.
  Action kinds: `text_overlay` (+ optional `tts`), `discord`, `voice` (one-shot or
  `marks:[{at_ms,text}]`), and the trigger-level countdown `_startTimer` `:29325-29378`
  (per-capture keying, `warn_ms`/`warn_text` from `warning_seconds`/`warning_text`).
- **Diagnostics** — checkpoint journal `:29937-29955`, `_rehearseTrigger` `:29996+`,
  `_synthesizeMatchingLine` `:29966-29994`, log replay `:30497+`.

### 2.3 Guild-trigger shape

`supabase/migrations/20260530000000_guild_triggers.sql:13-34` +
`20260530010000_guild_triggers_library_extension.sql:22-32`:
`pattern`, `pattern_flags`, `use_regex`, `end_early_pattern`, `end_use_regex`,
`actions jsonb`, `cooldown_seconds`, `timer_duration_sec`, `end_text`, `tags[]`,
`source_pack`, `trigger_again`, `applies_to_classes[]`, `default_scope`.
Shape is the "portable" one from `CLAUDE.md`: `text_overlay` + `tts` +
`timer_duration_sec` + `warning_seconds`/`warning_text`.

---

## 3. What they do correctly that WE FAIL ON

Ranked by blast radius. Every failure below is reproduced against a real fixture pattern;
`✅ theirs / ❌ ours` refers to the same input.

---

### 3.1 ❌ **We match against the raw line; every `^`-anchored imported trigger is dead** — 311 of 583

**Their mechanism.** `parser.go:317-326` strips `[Mon Jan _2 15:04:05 2026] ` and
`main.go:1462` hands `Handle` the bare message. GINA and EQLogParser both do the same, which
is why 53 % of real-world patterns start with `^`.

**Our mechanism.** `index.js:31926-31928` passes the whole line, `[Tue Aug 04 …] ` included.
`^` therefore anchors before the `[`. Nothing warns; the trigger simply never fires.

Real fixture (`Grokii_GINA_CharmBreak.gtp` → `ShareData.xml`):

```
pattern : ^Your (Charm|Beguile|Cajoling Whispers|Allure|Boltran`s Agacerie|Beckon|
          Command of Druzzil) spell has worn off of (.*).
line    : [Tue Aug 04 21:14:33 2026] Your Allure spell has worn off of a stone golem.
theirs  : MATCH  (sees "Your Allure spell has worn off of a stone golem.")
ours    : NO MATCH
```

This is not only an import problem — **our own shipped catalogue is affected**:

- `SUGGESTED_TRIGGERS` (`:26708-26791`): 12 of 17 templates start with `^`
  (`^Your (?:Clarity(?: II)?|…) (?:spell )?has worn off\.`,
  `^You have been (?:ensnared|rooted|bound)\.`, `^You feel (?:calm|charmed)\.`,
  `^You are afraid\.`, `^Your target resisted the (.+?) spell\.`, …). **They can never fire.**
- The original seeded guild trigger `'^Lord Nagafen has fully healed!$'`
  (`20260530000000_guild_triggers.sql:53`) had the same defect (since deleted).
- The code even documents the workaround the *other* parsers use
  (`:25915-25916`, "the #190 trap") without applying it to the trigger compiler.
- `index.js:31947` carries the tell: *"no dependency on the imported (non-firing) text trigger."*

**Compounding — the diagnostic lies about it.** `_synthesizeMatchingLine` `:29988` does
`src = src.replace(/[\^$]/g, '')` and never prepends a timestamp, so REHEARSE builds
`"Your Clarity II spell has worn off."`, the anchored regex matches at position 0, and the
checkpoint journal reports **"pattern matched synthesized line" / DISPATCHED**. A user
debugging a dead trigger gets a green light. `/api/triggers/test` `:20924-20952` is honest
by contrast (its placeholder line at `:18147` includes a timestamp) — the two diagnostics
disagree with each other.

---

### 3.2 ❌ **.NET scoped inline flags `(?i:…)` throw at compile time** — 92 of 583

Go/RE2 supports `(?i:…)` natively, so pq-companion never has to think about it.
JavaScript has no scoped-flag syntax and `new RegExp` throws `Invalid group`.
`_translateDotNetRegex` doesn't touch them, so they die at `:26525` / `:26667`
(caught, `console.warn`'d to a CLI nobody reads, trigger silently absent).

Real fixture (`GINA_FromJemi.gtp`, ×92 in that one pack — a shopping/auction trigger set):

```
^(?!(?:zotmule)(?!\w))(?<seller>[A-Za-z]*) auctions, \'(?i:WTS|selling).*
(?<item>(?i:blade of earth)).*\'
theirs : compiles + matches, captures seller=Ferrin item="Blade of Earth"
ours   : SyntaxError: Invalid regular expression: … Invalid group
```

The fix is nearly free for us: we already compile with the `i` flag by default
(`pattern_flags || 'i'`), so `(?i:` → `(?:` is *semantically exact*.

---

### 3.3 ❌ **`{s1}`/`{s2}` are renumbered by position, so action text resolves to the wrong capture** — 82 of 257 token patterns

**Theirs.** `normalizePattern` names the group after the *token's own digit*:
`{S1}`→`(?P<S1>…)`, `{S2}`→`(?P<S2>…)`. `substituteCaptures` then resolves `{s1}`/`{S1}`
by that name, or falls back to numbered group 1. Order-independent.

**Ours.** `_translateDotNetRegex:25848-25853` ignores the digit and allocates
`s, s1, s2, …` **in appearance order**. Every token past the first is off by one, and the
first `{s1}` becomes `s`.

Real fixture (`eqlogparser-triggers.tgf`, node "Enrage"; `TextToSpeak` = `"Enraged:  {s1}"`,
`AltTimerName` = `"Enraged:  {s1}"`):

```
pattern  : ^{s1} has become ENRAGED.
ours     : ^(?<s>[\w'` -]+?) has become ENRAGED.
match    : {"s":"Aten Ha Ra"}
TTS out  : "Enraged: {s1}"        <-- literal token spoken/printed
theirs   : "Enraged: Aten Ha Ra"
```

Worse when several tokens are present — real fixture, node "Assist":

```
pattern  : ^{s1} tells the raid{s2}assist{s3}(me|on|assist){s4}
ours     : ^(?<s>…)(?<s1>…)(?<s2>…)(me|on|assist)(?<s3>…)
```
`{s1}` in `TextToSpeak: "Assist {s1}"` now points at the **second** token — the punctuation
between "raid" and "assist" — not the caller's name. This is the failure mode the guild
lead will hate most: it does not error, it *speaks the wrong thing*.

The same drift hits `{c}`, which shares the allocator: `{s1} -> {c}: {s2}`
(fixture) compiles to `s`, `s1`, `s2` — `{c}` **steals the `s1` slot**.

Affected fixture patterns include:
`^{s1} has been awakened by {s2}.`, `^Your {s1} spell on {s2} has been overwritten.`,
`^Your {s1} spell did not take hold on {s2}.`, `You {s1} for {s2} of damage`,
`{S1} (pierces|hits|slashes|backstabs|crushes) YOU for {N1} points of damage.`

---

### 3.4 ❌ **`{c}` / `{C}` becomes a wildcard instead of your character's name** — 11 of 583

**Theirs.** `engine.go:515-521` — `{c}`/`{char}`/`{self}` (case-insensitive) expand to
`regexp.QuoteMeta(character)`; when no character is known yet the token is **left literal**
(an unmatchable string — deliberately safe), and `Reload()` re-runs on character change
(`engine.go:153-159`, wired to the tailer's `onCharacterChange`).

**Ours.** `[sScC]` is one character class in `_translateDotNetRegex`, so `{c}` and `{C}` are
expanded to the *same permissive capture as `{s}`*. There is no character binding anywhere
in the agent's trigger compiler.

Real fixture (`GINA_FromJemi.gtp`):

```
pattern : ^{c} begins watching the time.
ours    : ^(?<s>[\w'` -]+?) begins watching the time.
          -> fires for "Grokii begins…" AND "Melting begins…" AND every other player
theirs  : ^Grokii begins watching the time.
          -> fires only for you
```

Others in the corpus: `^{c}'s spell has been reflected by {s}.`,
`{C}'s corpse rises to serve {S}.`, `^([A-Za-z]*) says, 'Hail, {C}'`,
`{C}'s holy blade cleanses {S1} target![(]{N1}[)]`. Each is a personal alert converted into
a raid-wide false-positive generator. Combined with the guild relay (`_relayLocalFire`),
one such trigger fans a wrong callout to every Mimic in the raid.

---

### 3.5 ❌ **`{n}` / `{N}` / `{nN}` don't exist in the compile-time translator** — 17 patterns

`_translateDotNetRegex`'s class is `[sScC]` — no `n`. A hand-authored or officer-authored
`{n}` survives into the RegExp as the three literal characters `{`, `n`, `}` (JS Annex-B
treats a non-quantifier `{` as a literal), so the pattern compiles fine and **never matches**.

```
pattern : ^{s} won the need roll on {n} item(s).        (GINA_FromJemi.gtp)
ours    : ^(?<s>[\w'` -]+?) won the need roll on {n} item(s).
theirs  : ^(?P<S>.+) won the need roll on (?P<N>[0-9]+) item(s).
```

Only the *import* path knows about `{n}` (`_translateGinaPlaceholders`), so the behaviour
of a given pattern depends on which door it came through. Officer-authored guild triggers
in `/admin/triggers` go through the compile-time path only.

---

### 3.6 ❌ **The `{s}` character class is far too narrow** — silently drops legitimate matches

**Theirs.** `{S}` → `(?P<S>.+)` — matches anything.

**Ours.** `(?<s>[\w'`+ " ` " + `-]+?)` — word chars, apostrophe, backtick, space, hyphen only.
Excluded: `,` `.` `:` `!` `(` `)` `'` quotes, digits-with-punctuation, and any accented
character. The class was widened once (audit fix for `Rhag\`Zhezum`) but is still an
allow-list where the source semantics are "anything".

Real fixture: `^{s1} tells the raid{s2}assist{s3}(me|on|assist){s4}` — `{s2}` must span
`", '"`. Comma and quote are outside the class, so **the assist trigger cannot fire on our
engine at all**, even after the anchor is fixed (verified in `verify.js` §B).

Same defect kills item/spell captures containing parentheses
(`Words of Acquisition (Beza)`) and any capture spanning a sentence boundary.

---

### 3.7 ❌ **Action text: we understand `{name}` and nothing else** — 237 foreign token texts unresolved

**Theirs.** `substituteCaptures` handles `{0}`, `{1}…{9}`, `$0…$9`, `{name}`, `{S}/{SN}`
aliases, and `{c}/{char}/{self}/{target}/{t}` built-ins; `normalizeActionText`
converts GINA's `${…}` at import; `eqlpText` converts `{L}` → `{0}`.

**Ours.** `_expandTemplate` `:29907-29913` is `\{(\w+)\}` against `m.groups` only.
Measured behaviour (`verify.js` §F, real GINA action texts):

| GINA/EQLP action text | ours renders | theirs renders |
|---|---|---|
| `${seller} is selling ${item}` | `$Ferrin is selling $Blade of Earth` (stray `$`) | `Ferrin is selling Blade of Earth` |
| `${2} broke charm!` (Charm Break fixture) | `${2} broke charm!` | `a stone golem broke charm!` |
| `${1}: ${2}` (Skill-up fixture) | `${1}: ${2}` | `Baking: 121` |
| `Big Crit: {N}!` | `Big Crit: {N}!` | `Big Crit: 84213!` |
| `No Pets: {L}` / `{l}` (27 uses in one pack) | literal | (GINA `{L}` unmapped there too — a *shared* gap, see §3.11) |
| `RESISTED: {1}` — **our own** `SUGGESTED_TRIGGERS:26769` | `RESISTED: {1}` | n/a |

Note the last row: this is not only an import bug. Our own shipped suggested trigger
`cast_resisted_self` prints a literal `{1}` because we never implemented numbered groups.

Root cause is one line: `:30109` `const captures = m.groups || {}` — the match array `m`
(which carries `m[0]`, `m[1]`, …) is discarded before the action layer sees it.

---

### 3.8 ❌ **GINA `.gtp` import is advertised and completely broken**

The file picker accepts `.gtp` (`:18145`) and the help text says
*"or **GINA** (.gtp / XML)"* (`:18144`). But `.gtp` is a **PKZIP** container (magic
`50 4B 03 04`); the reader at `:18487` only checks for the **gzip** magic `1f 8b`:

```js
if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) { …gunzip… }
else { text = new TextDecoder('utf-8').decode(buf); }   // <-- a zip lands here
```

A `.gtp` is decoded as UTF-8 mojibake, `_parseTriggerXml` finds zero `<Trigger>` blocks,
and the UI reports **"Imported 0 of 0 triggers."** with no error. Every real GINA share
in the wild is a `.gtp`. pq-companion detects the zip magic and extracts `ShareData.xml`
(`importer.go:94-112`, `unwrapZip:132-184`).

---

### 3.9 ❌ **GINA timers are imported as cooldowns — semantic inversion**

`_parseTriggerXml:26886-26898` (quoted, 3 lines):
```js
const cooldownRaw = get('TimerDuration');
const cooldown    = parseInt(cooldownRaw, 10) || 0;
…
cooldown_seconds: cooldown,
```

GINA's `<TimerDuration>` is the **countdown length**; our XML path stores it as the
**anti-spam refire lockout** and never sets `timer_duration_sec`. Real consequences from
`GINA_FromJemi.gtp`:

| GINA trigger | intent | what we import |
|---|---|---|
| `^You experience a mystical transvergence.` | 300 s Mod Rod timer | fires once, then **muted for 5 minutes** |
| `TD Raptors` (`You have slain a Raptor`) | 450 s respawn timer | muted 7.5 min |
| `^You cast your line.` | 12 s fishing timer | muted 12 s |

Also dropped by the XML path entirely: `<TimerType>` (Timer / RepeatingTimer / Stopwatch),
`<TimerName>` (which carries `{S}`/`{C}`/`{COUNTER}` and is what the GINA user sees on the
bar — 74 `{S}` + 37 `{1}` + 3 `{COUNTER}` uses in the corpus), `<TimerEarlyEnders>`
(→ `end_early_pattern`), `<UseText>` / `<UseTextToVoice>` gates, `<PlayMediaFile>`.
pq-companion maps all of them (`gina.go:110-171`, `ginaDurationSecs:194-222`).

The EQLP JSON path (`_parseTriggerTgfJson:26910-26946`) is much better — it maps
`DurationSeconds`+`EnableTimer`+`TimerType` correctly and honours `LockoutTime` as the
cooldown — which makes the XML path's inversion look like an oversight, not a decision.

---

### 3.10 ❌ Smaller import-fidelity gaps (all present in `_parseTriggerTgfJson`)

| Field | theirs | ours |
|---|---|---|
| `EndUseRegex` / `EndUseRegex2` | honoured; literal enders QuoteMeta'd (`importer_eqlogparser.go:139-155`) | ignored — `:20904` hard-codes `row.end_use_regex = true`, so a literal ender like `Words of Acquisition (Beza)` is compiled as a regex |
| `EndEarlyPattern2` | joined into the alternation | **dropped** |
| `AltTimerName` | mined for the first token → per-mob timer key (`:216-228`) | dropped (13 fixtures use `{s1}`) |
| `PreviousPattern` | dropped **with a warning** | dropped silently |
| `TextToSendToChat` / `ChatWebhook` | dropped with a warning | dropped silently |
| `SoundToPlay` / `PlayMediaFile` | `applySoundFallback` → converted to TTS or dropped with a warning | dropped silently |
| bad pattern on import | imported **disabled** + `regex_ok:false` badge + wizard warning | pushed into `errors[]`, trigger not created; the summary line shows at most 3 |
| import preview | full review/select wizard before anything persists | fire-and-forget, everything committed |
| non-regex patterns | QuoteMeta'd **before** any token work | `_translateGinaPlaceholders` runs *first* (`:20889`) and its output is then escaped by `_escapeForLiteralMatch` — a literal containing `{s}` becomes `\(\.\+\?\)` |
| BOM / entity handling | BOM stripped in `DetectAndParse:114`; `encoding/xml` handles all entities | `/^\s*[\[{]/` at `:20860` fails on a BOM'd `.tgf` → routed to the XML parser → 0 triggers; `_decodeXmlEntities:26856-26864` handles only the 5 predefined entities (no `&#39;`) |

---

### 3.11 Gaps neither side handles (for completeness — don't over-promise)

- `{L}` / `{l}` in **GINA** action text (whole matched line) — 29 uses in the corpus.
  pq-companion maps it for EQLP only (`eqlpText`), not GINA.
- `{COUNTER}` / `{counter}` — GINA's per-trigger fire counter (4 uses). Neither implements it.
- `{TS}` — GINA's stopwatch token (1 use). Neither implements it.
- `{N>=50000}` / `{N>100000}` — GINA's numeric-comparison token (6 uses). pq-companion's
  `patternTokenRe` requires `[A-Za-z0-9_]` only, so `{N>=50000}` doesn't match and is left as
  a literal — **their pattern silently never fires either**. We can beat them here cheaply (§4.3).
- `(?x)` free-spacing and `(?n)` explicit-capture mode — no JS or RE2 equivalent.

---

### 3.12 What WE do better (keep these — don't regress them while fixing the above)

- **JavaScript beats RE2 on dialect coverage.** 95 of 583 corpus patterns use lookaround
  or backreferences and are imported **disabled** by pq-companion. We run them natively.
  The headline case is the EQLP CH-chain trigger
  (`(?<letter>[A-Za-z])\k<letter>{2,3}` — a `\k<>` backreference): verified matching in
  our engine, `caster/chainnum/target` all captured. Given `docs/DESIGN-ch-chain.md`, that
  is a trigger we specifically care about and they structurally cannot run.
- Charm-pet suppression (`_captureMatchesCharmPet`) — no equivalent there.
- The checkpoint journal, REHEARSE, and log replay are a better debugging story than their
  history pane (once §3.1's false-green is fixed).
- Cross-client relay + the raid callout allow-list — a guild feature they have no analogue for.
- `_translateDotNetRegex` already handles `(?>` atomic groups → `(?:`; pq-companion doesn't.

---

## 4. Adaptation plan for our agent (JS, single-file, zero-dep)

Ranked. Every function below is original and written in the file's existing idiom
(module-scope `_camelCase` helpers, `//`-block rationale comments, defensive `try/catch`,
no new npm deps — `zlib` in P5 is Node stdlib).

All of §4.1–§4.5 are **verified working** against the corpus: with them in place,
**583/583** regex-mode fixture patterns compile (vs. 491 today) and all 311 anchored
patterns match live lines. Harness: `scratchpad/pq-analysis/proto.js`.

---

### P0 — one shared scanner (everything else depends on it)

A naive `.replace()` cannot distinguish `^` (anchor) from `[^abc]` (negated class), or
`(?i:` (flag group) from `\(?i:` (literal). One pass, reused by P1 and P2.

```js
// ── Regex source scanner ────────────────────────────────────────────────────
// Walk a pattern once, calling visit(index, char, src) for every UNESCAPED
// character that is NOT inside a character class. Return a positive number from
// visit to skip that many characters (used when a construct was consumed).
// Everything in the trigger compiler needs this: a plain .replace() can't tell
// `^` (anchor) from `[^abc]` (negated class), and mis-rewriting one silently
// changes what a raid callout matches.
function _scanRegexSource(src, visit) {
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }              // escaped — skip the pair
    if (inClass) { if (ch === ']') inClass = false; continue; }
    if (ch === '[') { inClass = true; continue; }
    const skip = visit(i, ch, src);
    if (skip > 0) i += skip - 1;
  }
}
```

---

### P1 — anchor rewrite: make `^` mean "start of the log message" (fixes §3.1)

**Decision: rewrite at compile time, do NOT change what we feed the evaluator.**
Stripping the timestamp in `evaluateTriggersAgainstLine` would be cleaner (it's what
pq-companion does) but would instantly break every existing Wolfpack trigger that uses the
`\]\s+` idiom — which is all of ours. Rewriting `^` → `^(?:<timestamp>)?` is
**bidirectionally safe**: it matches with *or* without the prefix, so imported patterns
start working and hand-written `\]`-prefixed patterns are untouched (they contain no `^`).

```js
// ── EQ timestamp prefix ─────────────────────────────────────────────────────
// GINA and EQLogParser both strip "[Tue Aug 04 21:14:33 2026] " before matching,
// so >50% of real-world imported patterns are ^-anchored. We match the RAW line
// (the #190 convention every other parser in this file follows), which makes a
// bare ^ anchor BEFORE the bracket and the trigger can never fire. Rewriting
// each top-level ^ into "^(?:<ts>)?" keeps both dialects alive: the prefix is
// OPTIONAL, so a legacy \]\s+-style pattern is unaffected and an imported
// ^-pattern now matches — and, because the group is consumed rather than
// alternated, a leading {s1} capture no longer swallows the timestamp.
const EQ_TS_PREFIX_RX = '\\[[^\\]]{1,40}\\]\\s+';

// Rewrite every ^ that is a real start-of-string anchor: position 0, or right
// after '(', '(?:' or '|'. Anchors inside character classes are skipped by the
// scanner. Returns { source, rewrote } so the caller can surface "N anchors
// adapted" in the import summary.
function _rewriteAnchorsForRawLine(pattern) {
  const src = String(pattern || '');
  const spots = [];
  _scanRegexSource(src, (i, ch, s) => {
    if (ch !== '^') return 0;
    if (i === 0) { spots.push(i); return 0; }
    const before = s.slice(0, i);
    if (/\($/.test(before) || /\(\?:$/.test(before) || /\|$/.test(before)) spots.push(i);
    return 0;
  });
  if (spots.length === 0) return { source: src, rewrote: 0 };
  let out = '', last = 0;
  for (const i of spots) {
    out += src.slice(last, i) + '^(?:' + EQ_TS_PREFIX_RX + ')?';
    last = i + 1;
  }
  return { source: out + src.slice(last), rewrote: spots.length };
}
```

**Also fix the false-green diagnostic** — `_synthesizeMatchingLine:29988` must stop
deleting `^`/`$` blindly, and should prepend a synthetic timestamp so REHEARSE exercises
the same string shape the live tail produces:

```js
// Was: src = src.replace(/[\^$]/g, '');
// Now: keep the anchor semantics and give the pattern a realistic line to chew on.
src = src.replace(/\$$/, '');
if (src.startsWith('^')) src = src.slice(1);
src = '[' + new Date().toDateString().replace(/(\w+) (\w+) (\d+) (\d+)/,
      '$1 $2 $3 00:00:00 $4') + '] ' + src;
```

---

### P2 — dialect normalisation (.NET → JS) (fixes §3.2 and duplicate-name throws)

```js
// ── .NET / RE2 regex dialect → JavaScript ───────────────────────────────────
// GINA writes .NET regex; EQLogParser writes .NET regex; a pq-companion pack
// would write Go/RE2. JS is a THIRD dialect: it has lookbehind and backrefs
// (which RE2 lacks — that's our advantage) but NOT scoped inline flags, which
// .NET packs use heavily (92 of 583 patterns in the reference corpus). Every
// one of those throws "Invalid group" today and the trigger silently vanishes.
//
// Rewrites:
//   (?P<name>...)  -> (?<name>...)       Go/pq-companion named group
//   (?#comment)    -> removed            .NET inline comment
//   (?i:...)       -> (?:...) + 'i'      scoped flags hoisted to the RegExp
//   (?i)  ...      -> removed  + 'i'     global inline flags
//   (?>...)        -> (?:...)            atomic group (backtracking differs,
//                                        but EQ lines have no ambiguous nesting)
//   duplicate (?<x>…) -> (?<x_2>…)       legal in .NET, SyntaxError in JS
//                                        (V8 only allows duplicates across
//                                        alternatives from Node 23; Mimic is on
//                                        Electron 31 / Node 20 — assume no)
// Everything else is left alone: lookahead, lookbehind, \k<name>, \1, Unicode
// escapes and {2,3} repetition are all native JS and MUST survive untouched.
const _DOTNET_INLINE_FLAGS = 'imsxn';

function _normalizeRegexDialect(pattern, flags) {
  let src = String(pattern || '');
  let outFlags = String(flags || 'i');
  const warnings = [];
  const addFlag = (f) => { if ('ims'.includes(f) && !outFlags.includes(f)) outFlags += f; };

  src = src.replace(/\(\?P</g, '(?<');
  src = src.replace(/\(\?#[^)]*\)/g, '');

  // Inline flag groups. Collected first, applied back-to-front so earlier
  // indices stay valid while we splice.
  const edits = [];
  _scanRegexSource(src, (i, ch, s) => {
    if (ch !== '(' || s[i + 1] !== '?') return 0;
    const m = /^\(\?([a-zA-Z]*)(-[a-zA-Z]+)?([:)])/.exec(s.slice(i));
    if (!m) return 0;
    const on = m[1] || '';
    const off = m[2] ? m[2].slice(1) : '';
    if (!on && !off) return 0;                                  // (?:  (?=  (?!
    for (const c of on + off) if (!_DOTNET_INLINE_FLAGS.includes(c)) return 0;
    for (const c of on) {
      addFlag(c);
      if (c === 'x' || c === 'n') warnings.push('inline (?' + c + ') has no JS equivalent — ignored');
    }
    if (off) warnings.push('inline flag disable (?-' + off + ') has no JS equivalent — ignored');
    edits.push({ at: i, len: m[0].length, repl: m[3] === ':' ? '(?:' : '' });
    return m[0].length;
  });
  for (let k = edits.length - 1; k >= 0; k--) {
    const e = edits[k];
    src = src.slice(0, e.at) + e.repl + src.slice(e.at + e.len);
  }

  src = src.replace(/\(\?>/g, '(?:');

  // Duplicate named groups. .NET treats same-name groups as one group across
  // alternatives; JS throws. Rename the later ones and record the alias so the
  // capture bag can fold them back to the original name at fire time.
  const seen = new Set();
  const aliases = {};
  src = src.replace(/\(\?<([A-Za-z][A-Za-z0-9_]*)>/g, (whole, name) => {
    if (!seen.has(name)) { seen.add(name); return whole; }
    let n = 2, alt;
    do { alt = name + '_' + n++; } while (seen.has(alt));
    seen.add(alt);
    aliases[alt] = name;
    warnings.push('duplicate capture name "' + name + '" — second occurrence renamed ' + alt);
    return '(?<' + alt + '>';
  });

  return { source: src, flags: outFlags, aliases, warnings };
}
```

---

### P3 — one token table, one expander (fixes §3.3, §3.4, §3.5, §3.6, and the two-table split)

Replaces **both** `_translateGinaPlaceholders` and the token half of `_translateDotNetRegex`.
Naming rule: the token's own digit wins (`{s2}` → group `s2`), a bare `{s}` takes `s`
(preserving today's behaviour for existing personal triggers, and keeping
`_captureMatchesCharmPet`'s `/^s\d*$/` test working), and further bare tokens take the next
free `sN`.

```js
// ── GINA / EQLogParser pattern tokens ───────────────────────────────────────
// The ONE token table. Both tools write the same convenience placeholders into
// the pattern; previously we had two divergent translators (one at import, one
// at compile) that disagreed on naming, on the {s} character class, and on
// whether {n} existed at all — so the same pattern behaved differently
// depending on which door it came through.
//
//   {s} {S} {s1}..{s9} {S1}..   any text        -> (?<sN>.+?)
//   {n} {N} {n1}..{n9} {N1}..   a number        -> (?<nN>\d+)
//   {N>=50000} {N>100000}       number + guard  -> (?<nN>\d+) + a fire condition
//   {c} {C} {char} {self}       YOUR name       -> the escaped character name
//
// Non-negotiables, both learned from real packs:
//   • the group name comes from the TOKEN'S OWN DIGIT, never from its position
//     — "^{s1} tells the raid{s2}assist{s3}" must bind {s1} to the caller, and
//     positional naming silently spoke the wrong capture;
//   • {s} is `.+?`, NOT a character allow-list — the old [\w'` -] class could
//     not span ", '" and killed the whole assist/CH family of triggers;
//   • repetition syntax ({2,3}, {3,14}) must pass through untouched, which the
//     alpha-first key requirement below guarantees.
const TRIGGER_TOKEN_KINDS = {
  s: { rx: '.+?',  prefix: 's' },
  n: { rx: '\\d+', prefix: 'n' },
};

// Expand tokens. ctx.character binds {c}; when it's unknown the token is left
// LITERAL (an unmatchable string) rather than becoming a wildcard that fires
// for every player in the zone — recompile once the character is known.
// Returns { source, conditions[], warnings[] }.
function _expandTriggerTokens(pattern, ctx) {
  ctx = ctx || {};
  const used = new Set();
  const conditions = [];
  const warnings = [];
  const source = String(pattern || '').replace(
    /\{([A-Za-z][A-Za-z0-9_]*)((?:>=|<=|>|<|=)\s*\d+)?\}/g,
    (whole, key, guard) => {
      const lower = key.toLowerCase();
      if (lower === 'c' || lower === 'char' || lower === 'self') {
        if (!ctx.character) {
          warnings.push('{' + key + '} left literal — no active character detected yet');
          return whole;
        }
        return _escapeForLiteralMatch(ctx.character);
      }
      const kind = lower[0];
      const rest = lower.slice(1);
      if (!TRIGGER_TOKEN_KINDS[kind]) return whole;          // {target}, {spell}, …
      if (rest !== '' && !/^\d+$/.test(rest)) return whole;   // {seller}, {sender}, …
      const spec = TRIGGER_TOKEN_KINDS[kind];
      let name = spec.prefix + rest;
      if (rest === '') { let i = 2; while (used.has(name)) name = spec.prefix + i++; }
      if (used.has(name)) {
        let i = 2, alt = name;
        while (used.has(alt)) alt = name + '_' + i++;
        warnings.push('duplicate token {' + key + '} — second capture named ' + alt);
        name = alt;
      }
      used.add(name);
      if (guard) {
        const g = /^(>=|<=|>|<|=)\s*(\d+)$/.exec(guard.replace(/\s+/g, ''));
        if (g) conditions.push({ group: name, op: g[1] === '=' ? '==' : g[1], value: Number(g[2]) });
      }
      return '(?<' + name + '>' + spec.rx + ')';
    });
  return { source, conditions, warnings };
}
```

**One compile entry point** — replaces `_translateDotNetRegex` at all four call sites
(`:20938`, `:26524`, `:26666`, `:26684`) and `_translateGinaPlaceholders` at `:20889`/`:20904`:

```js
// ── The single trigger-pattern compiler ─────────────────────────────────────
// Import, guild poll, personal load and the /api/triggers/test box ALL go
// through here, so a pattern behaves identically no matter where it came from.
// Returns { regex, conditions, aliases, anchorsRewritten, warnings } and throws
// only if the final RegExp is genuinely unusable.
function compileTriggerPattern(pattern, opts) {
  opts = opts || {};
  const flags = opts.flags || 'i';
  if (opts.use_regex === false) {
    return { regex: new RegExp(_escapeForLiteralMatch(pattern), flags),
             conditions: [], aliases: {}, anchorsRewritten: 0, warnings: [] };
  }
  const warnings = [];
  const tok = _expandTriggerTokens(pattern, opts);
  warnings.push(...tok.warnings);
  const dia = _normalizeRegexDialect(tok.source, flags);
  warnings.push(...dia.warnings);
  const anc = opts.rawLine === false
    ? { source: dia.source, rewrote: 0 }
    : _rewriteAnchorsForRawLine(dia.source);
  return {
    regex:            new RegExp(anc.source, dia.flags),
    conditions:       tok.conditions,
    aliases:          dia.aliases,
    anchorsRewritten: anc.rewrote,
    warnings,
    source:           anc.source,          // for the dashboard's "compiled as" row
  };
}
```

`_compilePersonalTrigger` / `_applyGuildTriggersResponse` then stash
`_conditions` and `_aliases` alongside `_regex`, and `evaluateTriggersAgainstLine` gains one
guard just after the match, before the charm-pet check:

```js
    // GINA numeric guards ({N>=50000}): the capture matched, but the trigger
    // only fires when the number clears the threshold. Cheap — most triggers
    // carry no conditions at all.
    if (t._conditions && t._conditions.length && !_captureConditionsPass(t._conditions, m.groups)) {
      _journalTrigger({ trigger: t.name, scope: t._scope || 'personal', checkpoint: TJ.GATES,
                        stopped: true, reason: 'numeric guard not met' });
      continue;
    }

function _captureConditionsPass(conditions, groups) {
  for (const c of conditions) {
    const v = Number((groups || {})[c.group]);
    if (!Number.isFinite(v)) return false;
    if (c.op === '>='  && !(v >= c.value)) return false;
    if (c.op === '>'   && !(v >  c.value)) return false;
    if (c.op === '<='  && !(v <= c.value)) return false;
    if (c.op === '<'   && !(v <  c.value)) return false;
    if (c.op === '=='  && !(v === c.value)) return false;
  }
  return true;
}
```

---

### P4 — capture bag + full action-template resolution (fixes §3.7)

```js
// ── Capture bag ─────────────────────────────────────────────────────────────
// Everything an action template can reference, resolved once per fire. We used
// to pass m.groups alone, which threw away the numbered submatches — so GINA's
// "${2} broke charm!" and EQLogParser's "{1}: {2}" (and our OWN suggested
// trigger "RESISTED: {1}") printed their tokens literally.
//
// Keys: "0".."9" (0 = the whole match), every named group, {sN}/{nN} aliases so
// a pattern written with plain ( ) still answers {s1}, the renamed duplicates
// folded back to their original name, {L}/{l} = the whole log line, and the
// {c}/{char}/{self}/{target}/{t} built-ins. Built-ins never shadow a real
// capture — an explicit (?<target>…) wins.
function _buildCaptureBag(m, line, ctx, aliases) {
  ctx = ctx || {};
  const bag = Object.create(null);
  for (let i = 0; i < m.length; i++) if (m[i] != null) bag[String(i)] = m[i];
  if (m.groups) for (const k of Object.keys(m.groups)) if (m.groups[k] != null) bag[k] = m.groups[k];
  // Fold "name_2" duplicates back onto "name" when the first branch didn't match.
  if (aliases) for (const alt of Object.keys(aliases)) {
    if (bag[alt] != null && bag[aliases[alt]] == null) bag[aliases[alt]] = bag[alt];
  }
  // {s} <-> {s1} equivalence (GINA writes both for the same thing).
  for (const p of ['s', 'n']) {
    if (bag[p] != null && bag[p + '1'] == null) bag[p + '1'] = bag[p];
    if (bag[p + '1'] != null && bag[p] == null) bag[p] = bag[p + '1'];
  }
  // {sN} falls back to numbered group N for patterns using plain ( ).
  for (let i = 1; i <= 9; i++) {
    if (bag['s' + i] == null && bag[String(i)] != null) bag['s' + i] = bag[String(i)];
  }
  bag.L = bag.l = line;
  if (ctx.character) { bag.c = bag.char = bag.self = ctx.character; }
  if (ctx.target && bag.target == null) { bag.target = bag.t = ctx.target; }
  return bag;
}

// ── Action-text expansion ───────────────────────────────────────────────────
// Understands every reference dialect that shows up in imported packs:
//   ${name} ${2}   GINA                (the $ is consumed, not left behind)
//   {name} {2} {0} native + EQLogParser
//   $1 $2          .NET replacement form
// Anything that doesn't resolve is left EXACTLY as written, so literal braces
// and dollar signs in a callout survive. Replaces _expandTemplate.
function _expandActionTemplate(template, bag) {
  if (!template) return '';
  let out = String(template);
  out = out.replace(/\$\{([A-Za-z0-9_]+)\}/g, (whole, k) => _lookupCapture(bag, k, whole));
  out = out.replace(/\{([A-Za-z0-9_]+)\}/g,   (whole, k) => _lookupCapture(bag, k, whole));
  out = out.replace(/\$(\d)/g,                (whole, k) => _lookupCapture(bag, k, whole));
  return out;
}
function _lookupCapture(bag, key, fallback) {
  if (bag[key] != null) return String(bag[key]);
  const lower = String(key).toLowerCase();
  if (bag[lower] != null) return String(bag[lower]);
  return fallback;
}
```

Call-site change in `evaluateTriggersAgainstLine:30109`:
```js
    const captures = _buildCaptureBag(m, line, _triggerContext(), t._aliases);
```
where `_triggerContext()` returns `{ character, target }` from the existing
`stats.watchedLogs` / `_resolveMainTarget` plumbing. `_captureMatchesCharmPet` keeps
working unchanged (it filters on `/^s\d*$/`, and `{L}`/`c`/`target` don't match that).

---

### P5 — `.gtp` (PKZIP) support (fixes §3.8)

`zlib` is Node stdlib, so this stays zero-dependency. Do it **agent-side** so both the
file picker and a future drag-drop path get it.

```js
// ── Minimal PKZIP reader for GINA .gtp packages ─────────────────────────────
// A .gtp is a ZIP holding one ShareData.xml. We only need to find one member
// and inflate it, so this reads the End-Of-Central-Directory record, walks the
// central directory, and inflates the first match with zlib.inflateRawSync.
// Stored (method 0) and deflate (method 8) are the only methods GINA emits.
// Bounded: 64 MiB per member, and we never follow a nested archive.
const MAX_ZIP_MEMBER_BYTES = 64 * 1024 * 1024;

function _readZipMember(buf, wantName) {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return null;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method   = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize  = buf.readUInt32LE(p + 24);
    const nameLen  = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen   = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name     = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const base     = name.split(/[\\/]/).pop().toLowerCase();
    if ((!wantName || base === wantName) && rawSize <= MAX_ZIP_MEMBER_BYTES) {
      const lnLen = buf.readUInt16LE(localOff + 26);
      const leLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lnLen + leLen;
      const body  = buf.subarray(start, start + compSize);
      if (method === 0) return body.toString('utf8');
      if (method === 8) return require('zlib').inflateRawSync(body).toString('utf8');
      return null;   // unsupported compression — caller reports it
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return null;
}

// Sniff an uploaded import body. Returns { kind, text }: 'tgf' (EQLogParser
// JSON), 'xml' (GINA/EQLP SharedTriggers) or null. Handles the three real
// wrappers: raw text, gzip (.tgf.gz), PKZIP (.gtp).
function _unwrapTriggerImport(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = require('zlib').gunzipSync(buf);
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const xml = _readZipMember(buf, 'sharedata.xml') || _readZipMember(buf, null);
    return xml ? { kind: 'xml', text: xml } : null;
  }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);     // BOM — the .tgf sniff
  return { kind: /^\s*[\[{]/.test(text) ? 'tgf' : 'xml', text };
}
```

The import endpoint then accepts a base64 body (or `Content-Type: application/octet-stream`)
so binary survives the trip, and the dashboard's `onImportFile` (`:18477`) just posts the
bytes instead of decoding them.

---

### P6 — import field-mapping fixes (fixes §3.9, §3.10)

In `_parseTriggerXml:26865-26901`:
- add `<TimerType>`, `<TimerMillisecondDuration>`, `<UseText>`, `<UseTextToVoice>`,
  `<TimerName>`, `<TimerEarlyEnders>`;
- `timer_duration_sec` ← `TimerMillisecondDuration/1000` else `TimerDuration`
  (parse `HH:MM:SS` too, as `ginaDurationSecs` does) **when `TimerType` is Timer/RepeatingTimer**;
- **`cooldown_seconds` ← 0** for GINA (it has no lockout concept); keep `LockoutTime` for EQLP;
- `end_early_pattern` ← the `<EarlyEnder><EndingTrigger>` list joined `(?:a)|(?:b)`,
  QuoteMeta'ing any ender whose own `<EnableRegex>` is false;
- only emit an alert action when `UseText`/`UseTextToVoice` is true.

In `_parseTriggerTgfJson:26910-26946`:
- carry `EndUseRegex` → `end_use_regex` (stop hard-coding `true` at `:20904`);
- join `EndEarlyPattern2` into the alternation;
- carry `AltTimerName`'s first token into `timer_key_capture` so `_startTimer:29332-29346`
  keys per mob (it already supports per-capture keys — it just isn't told which one).

Adopt their **"import disabled + warning" contract** rather than dropping: on a compile
failure, store the row with `enabled:false` and a `warnings[]` array, and surface it in
the dashboard list with a badge. A silently-missing trigger is the worse failure mode.

---

### P7 — cheap wins on top

- `{L}`/`{l}` in action text: free, already in the bag (§3.11 — this beats them).
- `{COUNTER}`: a `Map<triggerId, count>` incremented in `_fireTriggerActions` and injected
  into the bag. ~6 lines; beats both GINA importers.
- Show the **compiled** source and any warnings in the dashboard's trigger row
  (`compileTriggerPattern` already returns `.source`, `.warnings`, `.anchorsRewritten`) —
  this is what makes the whole thing debuggable instead of magical.
- Bot side: run the same normaliser in `/admin/triggers` before INSERT so officers see the
  compiled form at authoring time. The bot passes rows through untouched today (`index.js:8031`).

---

### Test vectors (all verified in `scratchpad/pq-analysis/proto.js`)

`line` shown without the `[Tue Aug 04 21:14:33 2026] ` prefix that is actually present.

| # | input pattern | compiled | sample line | expected |
|---|---|---|---|---|
| 1 | `^Your (Charm\|Beguile\|Allure\|Boltran\`s Agacerie) spell has worn off of (.*).` | `^(?:\[[^\]]{1,40}\]\s+)?Your (…) spell has worn off of (.*).` | `Your Allure spell has worn off of a stone golem.` | match; `${2} broke charm!` → **"a stone golem broke charm!"** |
| 2 | `^{s1} has become ENRAGED.` | `^(?:\[…\]\s+)?(?<s1>.+?) has become ENRAGED.` | `Aten Ha Ra has become ENRAGED.` | `{s1:"Aten Ha Ra"}`; `Enraged: {s1}` → **"Enraged: Aten Ha Ra"** |
| 3 | `^{s1} tells the raid{s2}assist{s3}(me\|on\|assist){s4}` | `^(?:\[…\]\s+)?(?<s1>.+?) tells the raid(?<s2>.+?)assist(?<s3>.+?)(me\|on\|assist)(?<s4>.+?)` | `Grokii tells the raid,  'assist on Aten Ha Ra'` | `{s1:"Grokii", s2:",  '"}`; `Assist {s1}` → **"Assist Grokii"** |
| 4 | `^{s} won the need roll on {n} items.` | `^(?:\[…\]\s+)?(?<s>.+?) won the need roll on (?<n>\d+) items.` | `Melting won the need roll on 2 items.` | `{s:"Melting", n:"2"}`; `{s} won {n} — line: {L}` → **"Melting won 2 — line: [Tue …] Melting won the need roll on 2 items."** |
| 5 | `^{c} begins watching the time.` (character = `Grokii`) | `^(?:\[…\]\s+)?Grokii begins watching the time.` | `Grokii begins…` / `Melting begins…` | **match / NO match** |
| 6 | `^(?!(?:zotmule)(?!\w))(?<seller>[A-Za-z]*) auctions, \'(?i:WTS\|selling).*(?<item>(?i:blade of earth)).*\'` | `…(?:WTS\|selling)…(?<item>(?:blade of earth))…` (flags `i`) | `Ferrin auctions, 'WTS Blade of Earth 20k'` | `{seller:"Ferrin", item:"Blade of Earth"}`; `${seller} is selling ${item}` → **"Ferrin is selling Blade of Earth"** |
| 7 | `^(?<mob>.+) (?<action>\w+) YOU for {N>=50000} points of damage.` | `…(?<n>\d+) points…` + cond `n >= 50000` | `Aten Ha Ra kicks YOU for 61000 …` / `… for 900 …` | **fires / suppressed**; `{n}: ${mob} -> ${action}` → **"61000: Aten Ha Ra -> kicks"** |
| 8 | EQLP CH-chain with `\k<letter>` | unchanged (JS native) | `Hopeya tells the raid,  '002 CH Hitya'` | `{caster:"Hopeya", chainnum:"002", target:"Hitya"}` — **pq-companion imports this disabled** |
| 9 | `^You have become better at ([A-Za-z ]*)! \(([0-9]{1,3})\)` | `{1,3}` untouched | `You have become better at Baking! (121)` | `${1}: ${2}` → **"Baking: 121"** |
| 10 | `\]\s+(?<victim>[A-Za-z]+) has been slain by` (legacy Wolfpack idiom) | **unchanged** | `Hitya has been slain by Aten Ha Ra` | `{victim:"Hitya"}`; `RIP {victim}` → **"RIP Hitya"** (no regression) |

Regression vectors to add alongside: an existing personal trigger using bare `{s}`
(must still produce group `s`), a Zeal-condition trigger with an empty pattern
(must still compile to `_regex === null`), and `\d{2,3}` / `[^abc]` / `(?<=x)y`
(must pass through byte-identical).

---

## 5. Risks / effort / what NOT to adopt

### Effort

| Item | Effort | Risk | Blast radius if wrong |
|---|---|---|---|
| P0 scanner | 30 min | low | shared by P1/P2 — unit-test it first |
| P1 anchor rewrite | 1 h | **medium** | every trigger; the `^(?:ts)?` form is bidirectional so a mistake shows up as *extra* matches, not lost ones |
| P2 dialect normaliser | 2–3 h | medium | index-splice logic must be back-to-front; guard with the corpus test |
| P3 token table + one compiler | 2–3 h | medium | replaces two functions at 6 call sites |
| P4 capture bag / template | 1–2 h | low | additive; unresolved tokens still pass through |
| P5 `.gtp` reader | 2 h | low | isolated to import; fails closed |
| P6 field mapping | 2–3 h | low | import only |
| P7 polish + dashboard surfacing | 2 h | low | |

Total ≈ 1.5–2 focused days. **Agent-only** — no bot, web or schema change required for
P0–P5 (P7's officer-side normaliser is optional and lands separately on `main`).

### Risks

1. **P1 is the one that can change live behaviour for existing triggers.** Mitigation: the
   optional-prefix form can only *add* matches; ship it with the compiled source visible in
   the dashboard, and run the corpus harness in CI next to `npm run check:dashboard`.
2. **Widening `{s}` from `[\w'\` -]` to `.+?` will make some triggers fire more often.**
   That is the correct GINA semantic, but a lazy `.+?` at pattern start can capture a
   chat-line prefix. The anchor rewrite mitigates it for `^`-patterns; for unanchored ones,
   surface it and let `require_raid_member` / `_captureMatchesCharmPet` do their job.
   **Do not** re-narrow the class as a band-aid — that is the bug we're fixing.
3. **`(?i:` → `(?:` hoists case-insensitivity to the whole pattern.** Exact for us (we
   already compile with `i`), but if anyone ever sets `pattern_flags` without `i` the
   normaliser must add it — the code above does.
4. **Duplicate-group renaming changes `m.groups` keys.** The `aliases` fold in
   `_buildCaptureBag` covers action text; anything that reads `m.groups` directly (the
   end-early capture comparison at `:30076-30094`) should read the bag instead.
5. **Atomic-group `(?>` → `(?:` remains an approximation** (existing behaviour, kept). Fine
   for EQ log lines; note it in the import warnings.
6. **Import volume.** A 925-trigger GINA pack imported wholesale would swamp the personal
   list and the 2 MB body cap at `:20849`. Adopt some form of pq-companion's preview/select
   step, or at minimum a "N triggers — import all?" confirmation and a category tag.

### What NOT to adopt

- **`ExcludePatterns`.** That exists only because RE2 has no lookbehind. We have
  lookbehind and lookahead natively; adding a parallel exclusion mechanism would be
  ceremony that hides the real pattern.
- **Their `(?P<name>` output convention.** Go-only. We should *read* `(?P<` (in case
  someone shares a pq-companion pack) but never emit it.
- **Disabling triggers on lookaround/backreference.** 95 of 583 corpus patterns — that's
  their RE2 tax, not ours. Import them **enabled**; it's a real advantage over both
  pq-companion and (for backrefs) anything Go-based.
- **Moving matching to the frontend/overlay.** They keep matching in the backend and use
  the browser only for validation. Same as us — no change warranted.
- **Their timestamp-stripping approach as a drop-in.** Structurally cleaner, but our whole
  parser corpus (combat, chat, Zeal versions, CH chain, rolls, loot) is written against the
  raw line with `\]\s+` prefixes. P1's optional-prefix rewrite gets the compatibility win
  without a file-wide refactor. Revisit only if we ever split the trigger evaluator onto its
  own pre-stripped feed.
- **`{TS}` / GINA stopwatch semantics.** One occurrence in 1,189 triggers; neither engine
  implements it. Warn and move on.
