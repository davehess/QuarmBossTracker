# Security test plan — Wolf Pack platform

A repeatable red-team **verification** suite the platform owner (or someone they hire) runs to confirm the shipped
fixes hold and to catch regressions. It is keyed to the findings from the two October 2026 audits (DECISIONS §354,
and the private "Security audit, Oct 17" briefing tab).

## Rules of engagement

- **Authorized scope only: the Wolf Pack platform you own** — `wolfpack.quest`, `b.wolfpack.quest`, the bot at
  `wolfpackparse.up.railway.app`, the Supabase project, and a Mimic install on a machine you control. Nothing else.
- **Run against `b.wolfpack.quest` / beta and a test Mimic first**, never production, and **never during a raid
  window** (Sun/Wed/Thu 19:30–00:30 ET). A test that must touch production is marked ⚠ PROD and is read-only.
- **Non-destructive.** No test here changes durable state, posts to Discord, places a real bid, deletes data, or
  runs a real denial-of-service. The rate-limit checks send a small bounded burst (a few hundred requests) only to
  observe the 429 and then stop — they are not a flood, and they are the one thing to run off-hours.
- **Use your own credentials.** A test that needs a signed-in session uses a **throwaway test character / test
  Discord account you control**, never another member's. Never test with a credential you were not given.
- Keep a dated log of each run: what passed, what regressed, and the commit the platform was on.

This is defensive work: every case verifies a guard we built. If a case **fails** (the guard is gone), that is the
finding — fix it, re-run, and note it in DECISIONS.

---

## A. Confirm the shipped fixes still hold (regression)

These must all PASS. A failure means a fix regressed.

### A1 — Bot rejects bad tokens cheaply, no store lookup (bot 3.1.292 / §354)
- Send `GET /api/agent/poll` with `Authorization: Bearer wpms_notarealtoken`.
- **Expect:** `401`, fast, every time. A malformed token (not `wpms_` + 64 hex) must never cost a Supabase read.
- Regression tell: slow 401s, or memory growth under repeated random tokens (watch Railway memory on the metrics
  tab while the runner's A1 burst runs — it must stay flat).

### A2 — Per-IP rate limit (bot 3.1.292)
- From one IP, send a bounded burst of unauthenticated `GET /api/agent/poll` (the runner caps it).
- **Expect:** `429` with `Retry-After` once over the limit; `/health` stays `200` throughout.
- Regression tell: no 429 appears before the burst cap.

### A3 — Share links: rate limit, caching, revoke, noindex (web 1.8.176)
- Make a test raid share link (officer UI). Then:
  - loop the page past ~30/min from one IP → **expect** a "busy, try again" response, not more DB work;
  - fetch `/api/share/raid/<token>/replay` twice within a minute → **expect** the second is served from cache
    (identical, fast);
  - **revoke** the link in the officer UI, then fetch it → **expect** `404` within ~1 minute;
  - check `GET /robots.txt` disallows `/share/` and `/api/`, and every share response carries
    `X-Robots-Tag: noindex`.

### A4 — Corpses are not characters, and not readable (bot 3.1.291 / web 1.8.174)
- Confirm a name like `Someone's corpse480` never appears on `/me` under "Characters we think are yours".
- ⚠ PROD read-only: with the **public anon key** (it's in the page source), query `character_live_state` and
  `mimic_link_codes` — **expect** zero rows (RLS denies anon). This is the live-DB check we ran by hand; keep it in
  the suite so a future migration can't silently open them.

### A5 — Mimic's local server answers only Mimic (agent 3.7.195)
- On a test machine with Mimic running, from a browser page on any other origin, try
  `fetch('http://127.0.0.1:<port>/api/state', {mode:'no-cors'})` and a POST to `/api/shutdown`.
- **Expect:** the GET/POST is refused (`403 forbidden`) — a cross-site Origin, and a `Host` that isn't loopback,
  are rejected. Mimic's own overlays still work.
- Also: a damage row whose character name contains `<img src=x onerror=...>` must render as text in the dashboard,
  not execute. (Seed it by uploading a fight with that attacker name from a **test** character you own.)

---

## B. Confirm the OPEN findings are still open (so you know the exposure, until round two ships)

These are expected to **FAIL** today — that is the point: the test documents the live exposure and becomes the
regression test once each is fixed (private briefing, items 1–8). Run them from a **test** member account.

| Test | What it proves | Expected today |
|---|---|---|
| B1 Bid as another character | `POST /api/agent/place-bid` with `character` set to a character you do NOT own → does the bid go through? | Goes through (open) |
| B2 OpenDKP character at a rank | `POST /api/admin/opendkp-register` as a non-officer with `rank: "Raid Pack"` | Accepted (open) |
| B3 Wishlist bid read | `/wishlist show <someone else>` as a plain member | Shows their sealed bid (open) |
| B4 Callout relay content | Relay a crafted callout with an arbitrary `sound` URL containing the word "slow" | Plays on other Mimics (open) |
| B5 Cross-character write | `POST /api/agent/quarmy` / `inventory` with another character's name | Overwrites theirs (open) |
| B6 Discord mention | A fabricated `bosskill`/`pvp` payload with `@everyone` in a name | Pings everyone, if the bot has Mention Everyone (open) |

Stop each B test at the moment it demonstrates the gap — do **not** actually spam the raid channel, corrupt a real
character, or submit a real contested bid. Use a value that proves acceptance (e.g. a 1-DKP bid on a junk item in a
test auction) and no further.

---

## C. Boundary checks worth keeping

- **Share token entropy / enumeration:** a wrong-shaped or random token → identical `404`, no timing difference
  between "unknown", "expired" and "revoked".
- **Auth callback open redirect:** `/auth/callback?next=https://evil.example` → stays on your own origin.
- **No secrets in the public repo:** `grep` the tree for JWTs, Discord tokens, webhook URLs, `wpms_` tokens
  (expected: none — the audit found none; keep it as a guard).
- **CI secret exposure:** workflows use `pull_request`, not `pull_request_target` (forks get no secrets).

---

## How to run the mechanical checks

`node scripts/sec-check.mjs --target https://b.wolfpack.quest` runs the safe, non-destructive A-series network and
RLS checks (A1, A2 small burst, A3 headers, A4 anon-read). It refuses to run without an explicit `--target` and a
`--i-own-this-target` flag, defaults nothing to production, caps every burst, and makes no writes. B-series and the
Mimic-local and XSS checks are manual (they need a signed-in session, a test Mimic, or a seeded fight) and are
described above.

The owner may also hire an external tester: hand them this file and a **scoped, written authorization** naming the
hosts above, the test accounts, and the off-raid window.
