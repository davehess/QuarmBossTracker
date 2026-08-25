# Runbook — getting a member in when Discord sign-in won't work

Officer-facing. The complete procedure for both access paths that do not
require the member to complete Discord OAuth, plus reset and troubleshooting.
Built 2026-08-24 for Gonner/Lacunanight (Discord's "verify your account" /
phone-verification wall blocks OAuth **consent** — the member can chat in the
guild fine; only the authorize screen is blocked). First live use succeeded
same night.

Design + trust model + merge story: `docs/DECISIONS-2026-08-24.md`.
Architecture: the whole site keys on `auth.uid() → wolfpack_members.user_id`;
Discord OAuth's only structural job is writing that binding, so both paths
below just write the same binding a different way — every gate, officer
check, and `/me` ownership walk works identically afterwards.

---

## Which path does the member need?

| They want | Path | Member needs |
|---|---|---|
| The **website** (parses, raid pages, /me, …) | **Site-access invite** (§1) | a browser, nothing else |
| **Mimic** uploading under their identity | **Officer-assisted Mimic link** (§2) | Mimic installed |
| Both | Do §1 and §2 — they are independent | |

Both paths are **officer-attested**: the member never proves control of the
Discord account; you vouch for who they are. That is the same trust the guild
already extends for character↔member links, and every use is audited.

---

## §1 Site access — username + password via invite

1. **wolfpack.quest/admin/links** → card **"🔑 Site access without Discord
   sign-in"** → pick the member → **Generate invite link**.
2. **DM them the link.** It is single-use, expires in **7 days**, and the
   token in the URL is the secret — DM, never a channel.
3. They open it, pick a username (3–32 chars) and password (10+ chars), and
   are sent to the sign-in page. The **username + password form sits below
   the "Continue with Discord" button**.

That's it. Their guild roles flow in from the bot's 6-hour member sync, so
officer status, raid gating etc. all track Discord reality without Discord
sign-in.

**Password reset = send a fresh invite** to the same member. The claim page
recognises an invited account and resets its password instead of creating a
second identity. There is no email-based reset on purpose — nothing here ever
sends mail (the "email" on the account is `<username>@login.wolfpack.quest`,
synthesized, never deliverable).

## §2 Mimic identity — the 6-character code

1. Member installs Mimic normally (any version since June 2026 works — the
   change was entirely server-side) and clicks **Sign in to Wolf Pack**.
   Mimic shows a **6-character code** with a **10-minute timer**.
2. They read you the code — Discord chat is fine.
3. **wolfpack.quest/admin/links** → card **"🖥 Link a Mimic without Discord
   sign-in"** → enter the code, pick the member, **Authorize link**.
4. Their Mimic links within seconds and uploads under their real identity.

Code expired? They click Sign in again for a fresh one — the read-out and the
entry need to happen in the same sitting.

---

## Troubleshooting

- **"Wrong username or password" on their FIRST try** — as of web 1.1.95 that
  message appears only for a genuine credential failure; any other error shows
  its real text. First live use taught us: the server can show a *successful*
  sign-in while the member believes it failed — have them refresh before
  anything else.
- **"This member already signs in with Discord"** on an invite — the member
  row is bound to a real OAuth account. If they genuinely can't OAuth anymore,
  that's the merge story: see `DECISIONS-2026-08-24.md`, currently a manual
  cleanup.
- **"Your guild roles don't include site access yet"** — the member row's
  synced roles don't intersect `ALLOWED_ROLE_NAMES`. Fix the Discord role,
  wait for the 6-hour sync (or trigger a member sync), re-issue the invite.
- **"This invite was already used" and it wasn't them** — treat as a leaked
  token: issue a fresh invite (which is also the reset), and check
  `site_access_invites` / `mimic_sessions.linked_via` for what got created.
- **Auth config** (self-host or after Supabase changes): Auth → Providers →
  **Email must be Enabled**; **"Allow new users to sign up" must stay ON**
  (first-time Discord OAuth counts as a signup). "Confirm email" may be on or
  off — invited accounts are created pre-confirmed.

## What this does NOT cover

- **Members not in the Discord guild at all.** Both paths key on a
  `wolfpack_members` row, which only the guild sync creates. Someone outside
  the server has no identity here to bind.
- **Self-serve signup.** There is deliberately no path to an account without
  an officer in the loop.
