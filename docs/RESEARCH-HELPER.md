# Gemini research helper (local dev aid)

`scripts/research-helper.mjs` lets Claude call **Gemini** as a sub-agent for the
things it's weak at or blocked from: web-grounded research when Claude can't
reach a site, second-opinion fact-checks, and **image generation**. Zero deps,
keys from the environment, never committed. It is NOT part of the product and
the bot never imports it.

> **Runs on a LOCAL Claude Code session only.** The managed cloud environment
> blocks outbound traffic to `generativelanguage.googleapis.com` (proxy 403), so
> the helper only works from Claude Code on your desktop.

## The two environment variables

| Variable | What | Why two |
|---|---|---|
| `GEMINI_API_KEY` | Primary AI Studio key — suggest your **personal** Google account | the workhorse |
| `GEMINI_API_KEY_2` | Fallback key — your **Workspace** Google account | when the primary hits its free-tier rate limit, the helper fails over automatically → roughly double the daily headroom |

Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`; set `gemini-2.5-pro` for
harder questions), `GEMINI_IMAGE_MODEL` (default `gemini-2.5-flash-image`).

## Getting the keys on mobile (2 min per account)

Do this once per Google account. The key is an **AI Studio API key** — a
separate thing from the Gemini *app* subscription (the app is a chat UI; this is
programmatic access, free-tier eligible).

1. In your phone browser, go to **`aistudio.google.com/apikey`**.
2. Sign in with the account you want (start with your **personal** Google
   account). To switch accounts later: tap the profile circle, top-right → the
   other account.
3. Accept the terms if prompted.
4. Tap **Create API key** → **Create API key in new project** (or pick an
   existing project). It generates a key starting with `AIza…`.
5. **Copy it.** That's `GEMINI_API_KEY`.
6. Repeat for your **Workspace** account → that's `GEMINI_API_KEY_2`.
   - ⚠ If "Create API key" is greyed out or errors on the Workspace account,
     your Workspace admin has the Gemini API disabled for the tenant. Just use
     the personal key for both, or ask the admin to enable "Gemini for Google
     Cloud / AI Studio". The helper works fine with one key.

## Handing the keys to Claude safely

- **Do NOT paste keys into the cloud (web) Claude session** — egress is blocked
  there anyway, and it's a shared remote container.
- On your **desktop**, set them in your shell before launching Claude Code, e.g.
  `export GEMINI_API_KEY=AIza...` / `export GEMINI_API_KEY_2=AIza...` (or your
  OS's environment settings). Then Claude can call the helper via its shell.
- Never commit them. `.gitignore` already excludes `.env.research.local` and
  generated `gemini-image-*.png` so an accidental `git add .` can't leak them.

## Subscription vs API (READ THIS — the common trap)

A **Gemini Pro / Google AI Pro subscription is the Gemini *app*** (the UI at
gemini.google.com — Pro models, Imagen, Veo, higher app limits). This helper
calls the **Gemini *API***, whose quota + billing come from a **Google Cloud
project**, NOT the consumer subscription. Having Pro does **not** fund or unlock
the API. They are separate tracks. (Same distinction as "ChatGPT Plus ≠ OpenAI
API.") Plan bundles shift over time, but the reliable rule: the API key bills via
Cloud unless a specific plan explicitly says it includes API access.

## What works, and what costs money

- **Grounded research + fact-checks** — the API **free tier** covers this; works
  the moment a key is exported. A Pro subscription changes nothing here. The
  high-value case.
- **Image generation** (`--image`) — needs **Cloud billing enabled on the API
  project** (pay-per-use, a few cents/image), independent of any Pro sub. If
  `--image` returns "No image in the response," that billing isn't on (or
  `GEMINI_IMAGE_MODEL` needs adjusting). Alternative with zero API cost: generate
  images by hand in the Gemini app using the Pro sub — but the helper can't drive
  the app (that'd be UI-scraping), so app-generation is manual-only.
- **Video (Veo)** — real but **paid, per-clip, async**, and pricier than images.
  Not wired into this v1 on purpose. Ask Claude to add a `--video` mode once Cloud
  billing is on and the per-clip cost is acceptable.

## Usage

```
node scripts/research-helper.mjs "current Project Quarm raid-lockout timer for Emperor Ssraeshza"
node scripts/research-helper.mjs --image "a minimalist wolf-head sigil, gold on dark, flat vector" wolf.png
node scripts/research-helper.mjs --json "question"     # raw JSON for scripting
```

Model IDs and image modality flags drift over time; if a model 404s, check the
current names at `aistudio.google.com` and set `GEMINI_MODEL` /
`GEMINI_IMAGE_MODEL`.
