# Design skills — what is installed, what each one earned, what to load next

**Written 2026-09-16** for the guild lead, who asked which design skills this platform
actually uses before starting a dashboard rearchitecture "with more stylization
and less generic AI formatting."

⚠ `CLAUDE.md` stays the authority on precedence. `docs/DESIGN.md` records the
web visual system as it SHIPPED. This file is the third thing: an honest ledger
of the tooling, including where it cost more than it returned.

---

## 1. What is installed

Three skills are vendored into `.claude/skills/` and committed, so cloud
sessions get them without a per-machine install.

| Skill | Author / licence | What it is |
|---|---|---|
| `frontend-design` | ours, adapted from Anthropic's | The method, plus this platform's real tokens and the mid-raid constraints |
| `impeccable` | pbakaus, Apache-2.0 | Design commands, deterministic anti-pattern detectors, a finish reviewer, a documenter, two hooks |
| `ponytail` | DietrichGebert, MIT | "Laziest solution that works" — a YAGNI ladder |

**Precedence, from CLAUDE.md and unchanged:** `frontend-design` wins over
impeccable wherever they disagree, because it carries the tokens and the
constraints generic design advice cannot know. Use impeccable's DETECTORS
freely; treat its AESTHETIC guidance as a default that repo guidance overrides.
`ponytail` reinforces the minimal-diff rule and never replaces it.

**Two hooks run on every turn**, merged into `.claude/settings.json` alongside
the SessionStart digest rather than copied over it:

| Hook | Fires | Budget |
|---|---|---|
| `PostToolUse` | after every Edit/Write, no-ops on non-UI files | 5s |
| `Stop` | design deep pass at the end of a turn | 30s |

`/impeccable init` has deliberately NEVER been run. It writes `PRODUCT.md` and
`DESIGN.md` at the repo root, and three competing doc roots is how the next
session reads the wrong one.

---

## 2. The honest impact ledger

What each one has actually earned, with the evidence, not the pitch.

### `frontend-design` — the highest long-term value, and the only one that knows us

It is the single place that holds the twelve-colour token table, the monospace
decision, and the facts generic advice cannot have: an overlay is read in
peripheral vision by someone being hit by a dragon, so motion is a cost rather
than a delight, screen centre is sacred, density beats whitespace, and colour is
semantic before it is decorative.

Its real mechanism is the two-pass loop, and that loop is the actual defence
against generic output:

1. Plan the tokens BEFORE writing code — four to six named colours, at least two
   type roles, layout as prose plus a rough wireframe, and ONE signature element
   that embodies the brief.
2. **Critique that plan against the brief before building**, asking specifically
   whether it has collapsed into a generic default. Only then write code.

It also names three looks to avoid outright — cream with high-contrast serif and
terracotta; near-black with acid green; the hairline-ruled broadsheet — and our
copy adds a fourth: never introduce a second visual language.

**Verdict: keep, load first, every time.** Long-term this is the one worth
maintaining, because every other tool is generic by construction.

⚠ Honest qualifier: a good share of what feels like this skill working is
actually CLAUDE.md's own working rules doing the job — UI ships as two or three
genuinely different options previewed on beta, and cost is always FOUR numbers
(build, maintenance, runtime, change) rather than one word. Keep those rules
whatever happens to the skills.

### `impeccable` — one clear win, one clear loss, and a middle that is unproven

**The win, and it was a real one.** On 2026-08-28 the finish reviewer refused to
score the redesigned landing page and demanded real viewport captures instead of
a source read. That refusal found a way past a blocker that had already been
accepted, and the captures exposed four defects invisible in the source: the
wolf read as a ghost off to the right while the headline sat left, contradicting
the page's own written contract; her ears were clipped at both viewports; the
plate was washed out at hero scale with the pack behind it essentially
invisible; and a dead band sat between the buttons and the next section. The
page had shipped unverified. That is worth the whole install on its own.

**The loss.** The documenter generated a `DESIGN.md` of **357,109 lines** — one
paragraph repeated 23,774 times, once per character of a string some loop walked
— and it asserted something false about the artwork that had already caused a
shipped bug. It was thrown away and hand-written at 106 lines. Do not restore it
from git, and do not re-run the documenter without reading its output first.

**The unproven middle.** The two hooks have been running since 2026-08-28. This
session did substantial UI work across the vote page, the Mimic overlays, the
attendance section and the dashboard, and **no hook finding ever surfaced**.
That is not proof they do nothing, but it is the state of the evidence, and
CLAUDE.md already carries the standing instruction: if the deep pass costs more
than it returns, delete the `Stop` block and keep `PostToolUse`.

**Verdict: keep, but use it deliberately rather than passively.** Invoke the
finish reviewer with real captures at the end of a visual build. Run the
detectors. Skip the documenter. Re-evaluate the `Stop` hook on evidence.

### `ponytail` — near-zero measured impact so far, and that may be correct

No commit in this repo credits it, and nothing in this session changed because
of it. That is not damning: it answers "should this code exist at all", which is
a greenfield question, and almost everything this session touched was an edit to
something that already existed, where CLAUDE.md's minimal-diff rule is the
sharper tool anyway.

**Verdict: keep, cheap to hold.** Its moment is a rearchitecture, which is
exactly the dashboard case. Use it as a brake at the end, to remove one
accessory, not as a style input at the start.

### `dataviz` — never used here, and the biggest gap for a dashboard

Not vendored; available globally. It brings a form heuristic, a colour formula
with a runnable validator, mark specs, and interaction rules, so a set of charts
reads as one system instead of a pile of defaults. We have never loaded it,
because this platform's UI has been overlays and tables rather than charts.

**Verdict: this is the one to add for a dashboard.** Load it before the first
line of chart code, not after the first chart looks wrong.

---

## 3. What to load for a dashboard rearchitecture, in order

1. **`frontend-design`** — first, always. The two-pass loop above is the
   anti-generic mechanism; everything else is cleanup.
2. **`dataviz`** — before the first chart line.
3. **`impeccable` detectors**, then its **finish reviewer** with real captures
   at the end. Ignore its aesthetic layer, skip its documenter.
4. **`ponytail`** — last, to cut one accessory.
5. **`artifact-design`** — only if the thing ships as a published page rather
   than inside the Next.js app.

**Deliberately NOT `ui-ux-pro-max-skill`** (assessed and rejected 2026-09-13,
`docs/DECISIONS-2026-09-10.md`). It ships 79 UI styles, 192 palettes and 74 font
pairings and auto-activates on any UI request. It is a generator of generic
visual identities, which is precisely what `frontend-design` exists to override,
and a third voice on every UI task would need a third precedence rule. If one
piece of it is ever wanted, vendor that file into `frontend-design` rather than
the skill. `rtk` was rejected the same day for unrelated reasons.

---

## 4. The decision that actually gates "more stylization"

Our palette is essentially GitHub's Primer dark. It reads as a developer tool,
not as a 1999 fantasy MMO, and `frontend-design` flags this itself as an open
question: the identity does not come from the subject's own world. That may
still be the right call, because the audience is raiders reading parse tables
and it matches the agent dashboard — but it is **the guild lead's call, and not a
refactor to slip into an unrelated change**.

If the goal is a dashboard that feels authored rather than generated, decide
this up front in that session rather than discovering it halfway through:

- Does the dashboard stay inside the existing cross-surface visual family, which
  is a genuine asset (the same hex values appear in the Next.js app, the agent's
  local dashboard and every Mimic overlay), or is it allowed its own identity?
- The **monospace grid is worth keeping either way.** It is the strongest
  identity signal the platform has and it is doing real work: these screens are
  columns of numbers, and a monospace grid makes them scannable in a way a
  proportional face cannot.
- Whatever is chosen, spend boldness in exactly ONE place and keep everything
  around it quiet. The places already spent are the ORDER CONFLICT banner on the
  CH chain overlay, the monospace grid itself, and the caution-tape hatching on
  the threat meter.

---

## 5. One-line summary per skill

| Skill | Earned so far | Long-term value | Load for the dashboard? |
|---|---|---|---|
| `frontend-design` | The tokens, the constraints, the two-pass loop | **Highest** — the only one that knows this platform | Yes, first |
| `impeccable` finish reviewer | Caught four shipped hero defects source review missed | **High**, when invoked deliberately with captures | Yes, at the end |
| `impeccable` detectors | Deterministic, cheap, no false starts recorded | Medium | Yes |
| `impeccable` hooks | No surfaced finding in a heavy UI session | **Unproven** — re-evaluate the 30s `Stop` pass | Leave as-is, watch |
| `impeccable` documenter | Produced 357k unusable lines plus a false claim | **Negative** | No |
| `ponytail` | Nothing measurable | Medium on greenfield, low on edits | Yes, last |
| `dataviz` | Never used | **High for charts**, untested here | Yes, before the first chart |
| `ui-ux-pro-max-skill` | Rejected before use | Negative — generic by design | No |
