# Code signing — Raid Mimic (Windows)

> ## STATUS (2026-10-29): pipeline ready, waiting on the Azure account.
>
> Our side is built and **inert**: with the six settings below absent, the build is
> the unsigned build it has always been and CI stays green. The moment they exist,
> every Windows build (stable, beta, alpha) signs and verifies itself.
> Nothing is signed yet, because the Azure Artifact Signing account (and the
> identity validation behind it) does not exist yet. That part is the guild lead's.
>
> | Piece | Where |
> |---|---|
> | Signing hook (SignTool + Artifact Signing dlib, no-op without the settings, fails closed once configured) | `apps/mimic/scripts/azure-sign.cjs`, wired by `build.win.sign` in `apps/mimic/package.json` |
> | Detect / install tools / build / verify / release-body switch | `.github/workflows/release-mimic.yml` |
> | Tests | `test/codesign-wiring.test.js` |
>
> **Turning it on** (the guild lead):
>
> 1. **Azure subscription**, and register the `Microsoft.CodeSigning` resource provider on it
>    ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)).
> 2. **Create an Artifact Signing account** (resource group, a globally unique 3-24 character name,
>    a region, Basic pricing tier). Note the region: the endpoint below must match it.
> 3. **Identity validation as an individual**, Azure portal only. Individual public-trust validation needs
>    an applicant in the **US or Canada**; the details come from the Azure *billing account* (Account Type
>    "Individual"), whose legal name and sold-to address must match the government-issued ID used. You need the
>    **Artifact Signing Identity Verifier** role to see the New identity button. Microsoft quotes 1 to 20
>    business days. The certificate shows your name and your city/state/country, not street or email.
> 4. **Certificate profile**, type **Public Trust**, linked to that identity validation.
> 5. **App registration (service principal)** in Microsoft Entra ID, with a client secret, then assign it the
>    **Artifact Signing Certificate Profile Signer** role on the certificate profile (or the account)
>    ([roles](https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles)):
>    `az role assignment create --assignee <service principal object id> --role "Artifact Signing Certificate Profile Signer" --scope <certificate profile resource id>`.
> 6. **GitHub, repo Settings, Secrets and variables, Actions** (names are exact):
>    - **Secrets:** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (the app registration's tenant, application (client) id and secret value).
>    - **Variables:** `AZURE_SIGNING_ENDPOINT` (the regional endpoint, e.g. `https://eus.codesigning.azure.net`, listed in
>      [the integrations doc](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)),
>      `AZURE_SIGNING_ACCOUNT` (the account name), `AZURE_CERT_PROFILE` (the certificate profile name).
> 7. Push a Mimic beta. The run log's "Detect signing configuration" step says `configured=true`; "Verify
>    Authenticode signature" must pass; the release body then reads "code-signed by <your name>".
>    Partly configured (some but not all six) builds UNSIGNED and prints a warning, so a typo cannot half-sign.
>
> **First signed build checklist.** Verify step green; right-click the downloaded installer, Properties, Digital
> Signatures; install over an existing Mimic and confirm auto-update still works (the verify step already checks
> that `latest.yml`/`beta.yml` carry the signed installer's sha512).
>
> **Unverified until the first signed run** (no account exists to test against): that `windows-latest` has a
> .NET 8 runtime for the dlib (the workflow installs one anyway), that the NuGet package ids
> `Microsoft.Windows.SDK.BuildTools` and `Microsoft.ArtifactSigning.Client` (renamed from
> `Microsoft.Trusted.Signing.Client`) still resolve, and where the `x64` folders sit inside them (the install
> step searches for `x64\signtool.exe` and `x64\Azure.CodeSigning.Dlib.dll` and fails loudly if absent).
>
> **Design notes.**
> - *Why a hook, not `azureSignOptions`:* the installed electron-builder is `^24.13.3`, which has `win.sign`
>   (a custom function or module path, called for the app exe, installer and uninstaller) but **not**
>   `azureSignOptions` (electron-builder 25.x). No upgrade was needed or made. The upstream Azure path also
>   breaks on paths with spaces; our hook launches SignTool with an argument array and no shell.
> - *`signingHashAlgorithms: ["sha256"]`* is set because electron-builder otherwise calls the hook twice per file
>   (sha1, then a nested sha256); Artifact Signing is SHA-256 and the doubled signature would double the quota use.
> - *`latest.yml` needs no repair.* electron-builder signs inside the build and only then hashes the installer
>   (`NsisTarget` signs, then `createBlockmap`/`callArtifactBuildCompleted`), so `apps/mimic/scripts/patch-latest-yml.js`
>   (the SignPath-era repair) is **not wired** and is kept only for reference. The workflow's verify step checks the
>   match anyway.
> - *Signature quota:* each build signs the app exe, the uninstaller and the installer (three signatures) against
>   Basic's 5,000 a month.
> - *`publisherName` is deliberately not set* in `build.win`: with it, electron-updater would reject any
>   UNSIGNED installer (every secrets-less build), so a later change should add it only once every channel is signed.
> - Linux/Deck builds do not sign (`build-mimic-linux.yml` untouched); alpha shares `release-mimic.yml` and signs with the rest.
> - Web copy that says "not code-signed" (`web/lib/raidmimicSetup.ts` and friends) is not switched by the workflow;
>   revisit once the first signed stable ships.

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

## The case as it stands on 2026-09-18 (rebuilt — the OSI blocker is gone)

Two of the three historical rejections were **"not an OSI licence"** and
**"user base too small"**. Both have moved, and this section exists so the
application can be written from measured facts rather than adjectives. Every
figure below is checkable by the reviewer.

| Criterion a free-for-OSS signer asks | Where we now stand | Checkable at |
|---|---|---|
| **OSI-approved open-source licence** | ✅ **AGPL-3.0-or-later**, since 2026-09-18. This was the disqualifier under BSL 1.1 for part of one day and under nothing else — the project was BSD-3 before that | `LICENSE`, `docs/LICENSING.md` |
| **Source publicly available** | ✅ Public repository, full history, no private build steps | github.com/davehess/QuarmBossTracker |
| **Sustained development, not a weekend project** | ✅ **2,278 commits over 4.9 months**, first commit 2026-04-21, active daily | `git log` |
| **A real release history** | ✅ **730 published release tags — 145 stable, 584 prereleases** — with an automated build pipeline and a beta channel | the repository's Releases page |
| **Real users, not a demo** | ✅ An active raiding guild plus a separate beta-tester channel, with an auto-updater fleet. ⚠ **Put the actual number in the application, not in this file** — `CLAUDE.md` forbids publishing fleet-size figures, and this repo is public. Count PLAYERS, never characters (distinct `uploaded_by_discord_id`) | ask an officer; `agent_upload_stats` |
| **An identifiable maintainer** | ✅ One maintainer, named, contactable through the repository | — |
| **Reproducible, inspectable build** | ✅ GitHub-hosted runner, `release-mimic.yml`, no local build step | `.github/workflows/release-mimic.yml` |

**What to actually say in the application**, in one paragraph: *an open-source
(AGPL-3.0) Windows desktop client for an EverQuest emulator community, four
surfaces, 2,278 commits and 730 published releases in five months, built entirely
on GitHub-hosted runners, distributed to a raiding guild and its beta testers
through electron-updater. Installers are unsigned today, and the SmartScreen
"unknown publisher" warning is the single largest obstacle to non-technical
players installing it.*

**Why it is worth re-applying now rather than paying.** The free route was
closed by a licence that no longer applies. Before spending $9.99/month on Azure
Artifact Signing (below), re-apply to SignPath — the attribution it requires is
**already live in the site footer** (`web/app/layout.tsx`), so that side of the
bargain is pre-paid.

⚠ **If SignPath is approached again, state the licence as AGPL-3.0-or-later.**
The 2026-06 application claimed OSI status while the project was BSD-3 — which
was true then, and stopped being true for the few hours the project sat on BSL.
It is true again now. Do not describe the project as "source-available".

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
  `scripts/azure-sign.cjs` hook. **Correction (2026-10-29): we WOULD hit this.**
  The hyphenated `artifactName` only names the installer; the app exe inside is
  `Raid Mimic.exe` (productName "Raid Mimic"), which has a space and is signed
  by the same call. So we carry the same kind of hook, with SignTool launched by
  argument array so no quoting is involved.
- They use `oneClick: true`; we use `oneClick: false` with
  `allowToChangeInstallationDirectory: true`. Keep ours — but note that the
  directory chooser is exactly how users end up installing Mimic INSIDE the EQ
  folder, which is the documented way to break Zeal detection (CLAUDE.md, Mimic
  §field issue). Unrelated to signing; related to that installer flag.

## If we pursue it — the shape

1. An Azure subscription + an Artifact Signing account and certificate profile.
2. Identity validation as an individual (US/Canada) — the guild lead's call, and it
   requires real personal identity documents, which is a decision not a task.
3. CI signs with a service principal; there is **no hardware token to ship or
   plug in**. That is the practical reason this beats Certum Open Source
   (~$80/yr) despite costing more: post-2023 key-storage rules put OV certs on a
   physical HSM token, which a GitHub Actions runner cannot use.
4. `release-mimic.yml` gains the signing step back, ideally behind the same
   fail-open shape pq-companion uses — secrets present → signed; absent → build
   proceeds unsigned, CI stays green
   (`docs/pq-companion/06-data-provenance-and-gaps.md` §5).

**Still the guild lead's decision, not a task to pick up.** It costs money and requires
personal identity verification. What has changed is that it is now *possible*;
this file previously implied it was not.

## Why
Unsigned installers trigger the Windows SmartScreen "unknown publisher" warning,
which scares off non-technical guildies. Signing replaces "unknown publisher"
with our verified name. (Reputation — making the warning fully disappear — builds
over downloads on an OV cert; only an EV cert is instant. We chose the free
OV route.)

## Provider: SignPath.io Foundation (free, for open source)
Applied 2026-06 under BSD-3-Clause. ⚠ **The license moved twice on 2026-09-18** —
to BSL 1.1 (which is *not* OSI-approved and would have disqualified the project),
then the same day to **AGPL-3.0-or-later, which is OSI-approved**. So free
open-source signing is **eligible again**, and this is worth re-pursuing: it
removes the SmartScreen "unknown publisher" warning that scares off
non-technical guildies, and every Mimic installer still ships unsigned.
State the license as AGPL-3.0-or-later on any application (`docs/LICENSING.md`). Attribution is required and already live in the site footer
(`web/app/layout.tsx`): *"Windows code signing … provided free by SignPath.io,
certificate by SignPath Foundation."* Cheaper paid fallbacks if it's declined:
**Certum Open Source** (~$80/yr, individual-friendly) or **Azure Trusted
Signing** (~$10/mo, electron-builder has native support via `win.azureSignOptions`
— would replace the SignPath steps).

## What was pre-staged for SignPath (HISTORICAL — deleted; superseded by the status block at the top)
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
