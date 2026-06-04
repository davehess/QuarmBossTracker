# Code signing — Wolf Pack Mimic (Windows)

Status: **pre-staged, OFF.** The signing pipeline is wired into
`.github/workflows/release-mimic.yml` but inert until the SignPath Foundation
certificate is approved and the repo switches are set. Flipping it on is a
checklist (below), not a rebuild.

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
