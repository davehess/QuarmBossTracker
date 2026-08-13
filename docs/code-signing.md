# Code signing — Wolf Pack Mimic (Windows)

> ## ⚠ REOPENED 2026-08-13. The status line below was stale AND the blocker is gone.
>
> **Two corrections to what this file used to say.**
>
> **1. The pipeline is not "pre-staged, OFF" — it was DELETED.** When SignPath
> declined, the signing block was removed from `.github/workflows/release-mimic.yml`
> (see the comment at ~line 167). This file went on claiming a wired-but-inert
> pipeline existed. A doc asserting infrastructure that isn't there is the exact
> failure mode that had `/recall` confidently wrong about #202.
>
> **2. There is now a route that fits us, and it did not exist when this closed.**
> **Azure Artifact Signing** (formerly Trusted Signing) — Microsoft's own CA
> service. **$9.99/month** Basic (5,000 signatures, 1 certificate profile).
> Crucially, **as of April 2026 a self-employed individual can apply and the
> 3-year-history requirement from public preview is gone** — that history rule
> and "your user base is too small" were the two things that shut every previous
> door. GA in USA, Canada and Europe; individual **public-trust** certificates
> require the applicant be in the **US or Canada**.
>
> **Live precedent, same audience as ours:** `jmoyers/everquest-companion`, an
> Electron EQ Legends companion, ships an installer signed this way — publisher
> "Joshua Moyers", via a custom electron-builder sign hook.

## What signing does and does NOT do

Worth stating plainly, because "no SmartScreen prompt" is not what signing buys
on day one — the precedent repo's own README says so:

> *"If SmartScreen still shows a 'Windows protected your PC' warning while the
> certificate is new, click More info, then Run anyway — you only ever see it
> once."*

- **It does not instantly remove the warning.** Reputation still has to accrue.
- **It changes "Unknown publisher" to our name**, which is most of the trust win.
- **It makes reputation CUMULATIVE across releases** instead of resetting on
  every new binary hash. That is the real prize for a project that ships a beta
  every few days: unsigned, every single build starts from zero forever.

## What is NOT our problem (already solved)

⚠ Do not conflate the two Windows prompts. **The UAC/admin prompt is already
gone** — `apps/mimic/package.json` sets `perMachine: false` and
`allowElevation: false`, so Mimic already installs per-user with no admin
elevation, the same shape the precedent repo describes as "like Discord". The
only outstanding prompt is SmartScreen, and only signing addresses it.

Two smaller notes from reading their build config:

- They hit a real electron-builder bug: **its built-in Azure signing path breaks
  on file paths containing spaces**, so they route through a custom
  `scripts/azure-sign.cjs` hook. **We would not hit this** — our
  `artifactName` is `Wolf-Pack-Mimic-Setup-${version}.${ext}`, hyphenated. Worth
  knowing before anyone "tidies" that into a spaced product name.
- They use `oneClick: true`; we use `oneClick: false` with
  `allowToChangeInstallationDirectory: true`. Keep ours — but note that the
  directory chooser is exactly how users end up installing Mimic INSIDE the EQ
  folder, which is the documented way to break Zeal detection (CLAUDE.md, Mimic
  §field issue). Unrelated to signing; related to that installer flag.

## If we pursue it — the shape

1. An Azure subscription + an Artifact Signing account and certificate profile.
2. Identity validation as an individual (US/Canada) — Hitya's call, and it
   requires real personal identity documents, which is a decision not a task.
3. CI signs with a service principal; there is **no hardware token to ship or
   plug in**. That is the practical reason this beats Certum Open Source
   (~$80/yr) despite costing more: post-2023 key-storage rules put OV certs on a
   physical HSM token, which a GitHub Actions runner cannot use.
4. `release-mimic.yml` gains the signing step back, ideally behind the same
   fail-open shape pq-companion uses — secrets present → signed; absent → build
   proceeds unsigned, CI stays green
   (`docs/pq-companion/06-data-provenance-and-gaps.md` §5).

**Still Hitya's decision, not a task to pick up.** It costs money and requires
personal identity verification. What has changed is that it is now *possible*;
this file previously implied it was not.

## Why
Unsigned installers trigger the Windows SmartScreen "unknown publisher" warning,
which scares off non-technical guildies. Signing replaces "unknown publisher"
with our verified name. (Reputation — making the warning fully disappear — builds
over downloads on an OV cert; only an EV cert is instant. We chose the free
OV route.)

## Provider: SignPath.io Foundation (free, for open source)
Applied 2026-06. The project qualifies (public repo, OSI license BSD-3-Clause,
real users). Attribution is required and already live in the site footer
(`web/app/layout.tsx`): *"Windows code signing … provided free by SignPath.io,
certificate by SignPath Foundation."* Cheaper paid fallbacks if it's declined:
**Certum Open Source** (~$80/yr, individual-friendly) or **Azure Trusted
Signing** (~$10/mo, electron-builder has native support via `win.azureSignOptions`
— would replace the SignPath steps).

## What's pre-staged
1. **`.github/workflows/release-mimic.yml`** — between "Build Windows installer"
   and "Publish release", four steps gated on `vars.SIGNPATH_ENABLED == 'true'`:
   - upload the unsigned installer as a GitHub Actions artifact,
   - `signpath/github-action-submit-signing-request@v1` → signs it, writes the
     signed exe back to `apps/mimic/dist/`,
   - `node scripts/patch-latest-yml.js` → repairs the auto-update manifest,
   - `Get-AuthenticodeSignature` → fails the build if the result isn't validly signed.
   The release body line also switches from "Not code-signed yet…" to the signed
   note via the same `SIGNPATH_ENABLED` switch.
2. **`apps/mimic/scripts/patch-latest-yml.js`** — recomputes the exe's
   sha512+size in `dist/latest.yml` after signing.

### ⚠️ The latest.yml gotcha (why the repair step exists)
Authenticode embeds the signature in the .exe, so its bytes (hence SHA-512 and
size) change. electron-builder generated `latest.yml` from the *unsigned* exe; if
we shipped that unchanged, electron-updater would reject every auto-update with a
"sha512 mismatch" and silently break updates for everyone. `patch-latest-yml.js`
rewrites the exe's hash+size (top-level + its `files[]` row only; the unsigned
`.zip` row is left alone). The `.blockmap` is left stale on purpose — a mismatch
there just makes electron-updater fall back to a full download, which is safe.

## To turn it ON (when SignPath approves)
1. Repo → **Settings → Secrets and variables → Actions**:
   - **Variables:** `SIGNPATH_ENABLED=true`, `SIGNPATH_ORG_ID=<org id>`,
     `SIGNPATH_PROJECT=<project slug>`, `SIGNPATH_POLICY=<signing policy slug>`
     (SignPath gives you these on approval).
   - **Secret:** `SIGNPATH_API_TOKEN=<CI user API token from SignPath>`.
2. (Recommended) pin the SignPath action from `@v1` to a commit SHA.
3. Bump `apps/mimic/package.json` → a normal Mimic release. It builds signed.

## First signed build — validation checklist
Because the SignPath remote-signing handoff can't be tested without the cert,
check these on the FIRST signed run:
- [ ] The signed exe lands back at `apps/mimic/dist/Wolf-Pack-Mimic-Setup-*.exe`
      (same name, overwriting the unsigned one). If SignPath nests it in a
      subfolder, fix `output-artifact-directory` / move it before the repair step.
- [ ] "Verify Authenticode signature" step passes (Status = Valid, signer = your
      SignPath Foundation cert).
- [ ] Download the released exe → right-click → Properties → **Digital
      Signatures** shows the cert.
- [ ] Install over an existing Mimic and confirm **auto-update still works**
      (proves `latest.yml` matches the signed exe).
- [ ] Update the footer credit / release copy if any wording needs to change.

## Not signed (and why)
- The bundled **agent** and the **standalone parser zip** aren't separately
  Authenticode-signed (they're scripts/Node, not a PE the SmartScreen gate
  applies to). The thing users double-click — the Mimic installer — is what gets
  signed.
- **Self-signed certs** do nothing for SmartScreen; don't bother.
