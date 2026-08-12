# Runbook — a local copy of wolfpack.quest on Unraid, via Coolify

**Decided 2026-08-11 (Hitya):** Coolify in a **VM on Unraid**, and the local site
points at the **local Supabase stack** (`RUNBOOK-unraid-supabase-replica.md`), so
nothing clicked locally can touch production.

**Why a VM and not bare Unraid.** Coolify's installer expects systemd and control
of the Docker daemon, and it runs its own proxy on ports 80/443 — Unraid's web UI
is on port 80. A VM sidesteps all of it and lets Coolify work exactly as
documented. (Coolify's dashboard is on `:8000`, same number as the Supabase
gateway, but they are different hosts so there is no clash.)

---

## Part A — the VM

Unraid → **VMS** → Add VM → **Debian 13 (trixie)**. Not bookworm: Debian 12 hit
end of regular support in 2026 and is LTS-only now (Hitya spotted it, 2026-08-11)
— nothing on fire, but a fresh build should start on current stable. A ready-made
libvirt XML is in the appendix below; paste it into Add VM → **XML View**.
Settings:
- 2 vCPU, **8 GB RAM**, 40 GB vdisk. ⚠ **4 GB is NOT enough** — measured
  2026-08-11: `next build` reached `✓ Compiled successfully` and was then
  OOM-killed during *"Linting and checking validity of types"*, the
  memory-hungriest phase. The signature is a build log that simply STOPS with no
  error and an exit 255; confirm with `dmesg -T | grep -iE 'killed process|out of
  memory'` on the VM. If 8 GB still isn't enough, add a Coolify build variable
  `NODE_OPTIONS=--max-old-space-size=6144` — Node's heap ceiling does not
  automatically follow a RAM increase
- Network: **br0** so it gets its own LAN IP (not the NAT default) — Coolify and
  the site need to be reachable from your desktop
- Install with SSH enabled; note the IP (referred to below as `<VM-IP>`)

## Part B — Coolify

SSH into the VM:
```
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```
Then open `http://<VM-IP>:8000` and create the admin account.

## Part C — connect the private repo

The repo is private, so Coolify needs credentials. Easiest path:
**Projects → New Resource → Private Repository (with deploy key)**. Coolify
generates an SSH public key; paste it into GitHub → repo → Settings → Deploy keys
(read-only is enough). Then point it at `davehess/QuarmBossTracker`, branch `main`.

## Part D — application settings

The repo is a monorepo and the site is NOT at the root:

| Setting | Value |
|---|---|
| Build Pack | Nixpacks |
| **Base Directory** | `/web` ← the load-bearing one |
| Ports Exposes | `3000` |
| **Ports Mappings** | **`3000:3000`** ← publishes it; Exposes alone does NOT |
| Branch | `main` (or `beta` for a mirror of the beta line) |

`web/` has its own `package-lock.json`, so `npm ci` inside that directory works —
there is no npm-workspaces wiring to fight.

## Part E — environment variables

⚠ **`NEXT_PUBLIC_*` are baked in at BUILD time by Next.js.** In Coolify they must
be marked as **Build Variables**, not just runtime env, or the browser bundle
ships with them undefined and the site loads but can't reach Supabase.

```
NEXT_PUBLIC_SUPABASE_URL=http://192.168.1.5:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from the Supabase stack's .env>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from the same .env>
NEXT_PUBLIC_SITE_URL=http://<VM-IP>:3000
DISCORD_GUILD_ID=1168893924329402420
ALLOWED_ROLE_NAMES=Pack Member,Officer,Guild Leader
NIXPACKS_NODE_VERSION=20
```

Use the LOCAL stack's keys — the ones generated for the Unraid compose, never the
cloud project's. They are different trust domains and the local anon key is the
only one the local GoTrue will honor.

⚠ **`Ports Exposes` and `Ports Mappings` are different fields, and only the
second one publishes to the host** (hit 2026-08-11). With Exposes alone,
`docker ps` shows a bare `3000/tcp` — metadata for the proxy, nothing listening
on the LAN — and the browser gets ERR_CONNECTION_REFUSED while Coolify still
reports the app Running. Published looks like `0.0.0.0:3000->3000/tcp`. After
setting it, **Redeploy, not Restart**: Docker can only apply port mappings when
the container is recreated.

**VERIFIED LIVE 2026-08-11:** built in ~5 min on Node 20 with 8 GB, site serving
at `http://192.168.1.163:3000`. Note the roadmap page renders from static
`web/lib/roadmapData.ts`, so it proves the BUILD only — open `/parses` or
`/boards` to prove the Supabase link end to end.

At this point Deploy gives you the public pages. Sign-in needs Part F.

## Part F — Discord sign-in against the LOCAL stack

The sign-in gate (`web/app/auth/callback/route.ts`) does three things: confirms
guild membership via Discord's live API, resolves role IDs through the restored
`wolfpack_roles`, then upserts `wolfpack_members` **`onConflict: 'discord_id'`**.
That last detail is why this works locally at all: the row keys on Discord ID, so
a local GoTrue user with a brand-new `auth.users` UUID still lands on the restored
member row.

**Use a SEPARATE Discord app for the local sandbox** (revised 2026-08-11). The
CLAUDE.md "never a second Discord app" rule is about `b.wolfpack.quest`, which
shares the PRODUCTION Supabase project — a second app there would force a second
project and diverge `auth.users`. The local stack is already a separate project
by construction, so that objection does not apply, and a separate app avoids the
one genuinely dangerous step (resetting the production client secret). Verified
in code: `SignInButton` requests scopes `identify guilds.members.read` and the
callback checks the SIGNED-IN USER's membership with their own token
(`GET /users/@me/guilds/{id}/member`) — **the Discord app itself never needs to be
in the guild**, so any app works.

### F1 — create a sandbox Discord app (do NOT reuse production's)

Discord Developer Portal → **New Application** → `Wolfpack Local` → OAuth2 → copy
the Client ID, Reset Secret and copy that too (a fresh app has nothing to break),
then OAuth2 → Redirects → Add `http://<supabase-gateway>:8000/auth/v1/callback`.

⚠ Do NOT reset the PRODUCTION app's secret to obtain it. Discord shows a secret
once; resetting it **breaks production sign-in** until the cloud Supabase provider
config is updated with the new value. A sandbox app sidesteps that entirely.

### F2 — enable the provider in the local GoTrue

Compose → `auth` service → `environment:` (the file already has commented
Google/GitHub/Azure examples in exactly this shape):
```yaml
      GOTRUE_EXTERNAL_DISCORD_ENABLED: "true"
      GOTRUE_EXTERNAL_DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}
      GOTRUE_EXTERNAL_DISCORD_SECRET: ${DISCORD_SECRET}
      GOTRUE_EXTERNAL_DISCORD_REDIRECT_URI: ${API_EXTERNAL_URL}/callback
```
`.env`:
```
DISCORD_CLIENT_ID=<from the Discord app>
DISCORD_SECRET=<from the Discord app>
SITE_URL=http://<VM-IP>:3000
ADDITIONAL_REDIRECT_URLS=http://<VM-IP>:3000/**
```

⚠ **Sign-in and sign-out landing on `localhost:3000` was a real code bug, fixed
in web 1.1.41** (found here 2026-08-11). Every redirect in `app/auth/callback`
and `app/auth/signout` was built from `new URL(req.url).origin`, and Next
resolves `req.url` against the SERVER's own listening address — inside a
container that is `http://localhost:3000`. Vercel hid it because its proxy
rewrites the request first. Now `web/lib/request-origin.ts` prefers
`x-forwarded-host` then `Host`, covered by `test/request-origin.test.js`. If a
local mirror predates that version, redeploy it before debugging redirects.

⚠ **`ADDITIONAL_REDIRECT_URLS` is the same trap that broke beta sign-in**
(Hitya, 2026-08-10). `SignInButton` sends `redirectTo = window.location.origin +
'/auth/callback'`, and GoTrue **silently ignores a redirectTo that is not on the
allow list and uses SITE_URL instead** — nothing errors, sign-in just never takes.

### F3 — add the callback to the Discord app

Discord Developer Portal → your existing app → OAuth2 → Redirects → **Add**:
```
http://192.168.1.5:8000/auth/v1/callback
```
That is the Supabase GATEWAY's address, not the website's — Discord talks to
GoTrue, which then bounces the user back to the site. Keep every existing redirect
URI in place; this is an addition, never a replacement.

Then Compose Up the Supabase stack and redeploy in Coolify.

---

## What this gets you, and what it does not

- **Full site, real restored data, zero production risk.** Officer pages can be
  clicked freely; the writes land in the local copy.
- **The data is a SNAPSHOT**, refreshed only when you restore a newer nightly
  dump. It does not track production live (that was the deliberately-deferred
  replication path).
- **`/me` surfaces work** because they key off `characters.discord_id`, which is
  stable across the two auth stores.
- **Not a failover site.** If Vercel is down, this does not serve the guild — it
  has no public DNS, no TLS, and its database stops at the last restore.


---

## Part G — automation (the point of all this)

Three things run without anyone clicking. Each exists because of something that
actually went wrong, not because it was tidy.

### G1 — the mirror follows `main` by itself

`scripts/coolify-autodeploy.sh` + `scripts/systemd/coolify-autodeploy.{service,timer}`
poll GitHub every 5 minutes and trigger Coolify's deploy webhook when the branch
head moves. Install steps are in the script header.

**Polling, not a webhook, on purpose.** Coolify's built-in auto-deploy needs GitHub
to reach Coolify; ours is on a LAN VM with no public address, and the two ways to
change that — publishing port 8000, or a Tailscale Funnel — both put a dashboard
that can deploy arbitrary containers on the open internet. Polling is outbound
only: nothing inbound, no tunnel, no exposure. The cost is up to 5 minutes of lag,
which for a sandbox is nothing.

**Why bother auto-deploying a sandbox at all:** it is the only place the site runs
outside Vercel, which makes it the canary for Vercel-masked bugs. Exactly one such
bug had been shipping unnoticed — every auth redirect built from
`new URL(req.url).origin`, which resolves to localhost in a container and is
invisible behind Vercel's proxy (web 1.1.41). A mirror that tracks `main`
automatically catches the next one. A mirror that needs a click drifts and catches
nothing.

The script records the deployed SHA only when Coolify *accepts* the trigger, not
when the build succeeds. A failing build is a thing to go look at; re-triggering
the same broken commit every 5 minutes would bury the logs. The fix is a new
commit, which the next tick picks up regardless.

### G2 — the sandbox data refreshes nightly

`scripts/refresh-local-archive.sh`, Unraid User Scripts, `30 5 * * *` — half an
hour after the 05:00 backup. Restores the newest dump into the local stack.

**It MERGES rather than restores** (2026-08-12): rows production prunes on its
retention timers survive here forever, so the local box is the long-horizon
archive rather than a second copy of the same 7 days. Per-table behaviour is an
explicit allowlist in `scripts/lib/archive-merge.sql`, proved by
`scripts/test-archive-merge.sh`.

A snapshot nobody refreshes is worth less every day, and eventually stops
representing production while still *looking* like it does — which is how a
sandbox starts producing confidently wrong answers. It also **re-proves the
backup every night**: a dump that restores cleanly is a dump you can rely on in a
real loss, and that verification is the part most backup setups never get.

Guards: it follows the `latest.dump` symlink to the real file, refuses anything
under 50 MB, and treats "is `encounters` queryable afterwards" as the pass/fail
rather than `pg_restore`'s exit code — which is always non-zero here because of
the three expected, harmless errors.

### G3 — deploy failures reach Discord

Coolify → **Notifications → Discord** → paste a channel webhook URL, tick
deployment failure. Without it an unattended deploy that breaks is silent until
someone happens to open the mirror — which defeats the canary in G1.

### Deliberately NOT automated

- **Applying migrations to the local stack.** They arrive with the nightly dump's
  schema anyway, and a script that runs DDL against a database on a schedule is
  the kind of thing that is fine 50 times and catastrophic once.
- **Auto-deploying anything on a raid night.** The mirror is harmless, but the
  freeze in CLAUDE.md is about `main` — and `main` is what Vercel and Railway
  deploy from. This poller only ever touches the LAN copy.

---

## Appendix — VM definition (Unraid → VMS → Add VM → XML View)

Generate a FRESH `uuid` and `mac` if you ever build a second one; duplicates
break libvirt. `br0` is the load-bearing line — the default `virbr0` NATs the VM
and makes both Coolify and the site unreachable from your desktop. SeaBIOS rather
than OVMF on purpose: no nvram file to go wrong on a headless server VM.

⚠ **Create the vdisk before starting.** An XML-defined VM does not auto-create
its disk image — only Form View does — so a pasted XML fails to start with
*"Cannot access storage file … No such file or directory"* (hit 2026-08-11):
```
mkdir -p /mnt/user/domains/Coolify
qemu-img create -f raw /mnt/user/domains/Coolify/vdisk1.img 40G
```
The raw image is sparse: it reports 40G but consumes only what is written.

Delete the `<disk device='cdrom'>` block once Debian is installed, or it can boot
the installer again. Install `qemu-guest-agent` in the guest and Unraid's VMs tab
will report the VM's IP for you.

⚠ **Boot order goes on the disks, never both places.** Combining `<boot dev='hd'/>`
inside `<os>` with per-device `<boot order='N'/>` fails VM creation with
*"per-device boot elements cannot be used together with os/boot elements"*
(hit 2026-08-11). The XML below uses the per-device form only.

⚠ If Coolify's installer refuses trixie (its supported-distro check can lag a
Debian release), Ubuntu 24.04 LTS is the fallback — everything else in this
runbook is unchanged.

```xml
<domain type='kvm'>
  <name>Coolify</name>
  <uuid>5031ece5-48b6-4779-8201-4c20a96573c7</uuid>
  <description>Coolify host — runs the local copy of wolfpack.quest</description>
  <metadata>
    <vmtemplate xmlns="unraid" name="Debian" icon="debian.png" os="debian"/>
  </metadata>
  <memory unit='KiB'>4194304</memory>
  <currentMemory unit='KiB'>4194304</currentMemory>
  <vcpu placement='static'>2</vcpu>
  <os>
    <type arch='x86_64' machine='q35'>hvm</type>
    <!-- Boot order lives on each <disk> below as <boot order='N'/>.
         Do NOT also add <boot dev='hd'/> here: libvirt rejects the mix with
         "per-device boot elements cannot be used together with os/boot
         elements". Empty vdisk falls through to the CD on first start, then
         boots the installed system once the disk is bootable. -->
  </os>
  <features>
    <acpi/>
    <apic/>
  </features>
  <cpu mode='host-passthrough' check='none' migratable='on'>
    <topology sockets='1' dies='1' cores='2' threads='1'/>
  </cpu>
  <clock offset='utc'>
    <timer name='rtc' tickpolicy='catchup'/>
    <timer name='pit' tickpolicy='delay'/>
    <timer name='hpet' present='no'/>
  </clock>
  <on_poweroff>destroy</on_poweroff>
  <on_reboot>restart</on_reboot>
  <on_crash>restart</on_crash>
  <devices>
    <emulator>/usr/local/sbin/qemu</emulator>

    <!-- Main disk. CREATE IT FIRST — an XML-defined VM does NOT auto-create
         the image (only Form View does), and starting without it errors with
         "Cannot access storage file ... No such file or directory":
           mkdir -p /mnt/user/domains/Coolify
           qemu-img create -f raw /mnt/user/domains/Coolify/vdisk1.img 40G
         NOTE: /mnt/user is the FUSE layer — if your appdata/domains share
         lives on a pool, /mnt/cache/domains/... is measurably faster. -->
    <disk type='file' device='disk'>
      <driver name='qemu' type='raw' cache='writeback'/>
      <source file='/mnt/user/domains/Coolify/vdisk1.img'/>
      <target dev='hdc' bus='virtio'/>
      <boot order='1'/>
    </disk>

    <!-- Debian 13 (trixie) installer ISO. Change to your actual filename.
         After the install completes, delete this whole <disk> block. -->
    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <source file='/mnt/user/isos/debian-13-netinst.iso'/>
      <target dev='hda' bus='sata'/>
      <readonly/>
      <boot order='2'/>
    </disk>

    <controller type='usb' index='0' model='qemu-xhci' ports='15'/>
    <controller type='pci' index='0' model='pcie-root'/>
    <controller type='pci' index='1' model='pcie-root-port'/>
    <controller type='pci' index='2' model='pcie-root-port'/>
    <controller type='pci' index='3' model='pcie-root-port'/>
    <controller type='virtio-serial' index='0'/>

    <!-- br0 = its own IP on your LAN, which Coolify and the site need.
         The default virbr0 would NAT it and make both unreachable. -->
    <interface type='bridge'>
      <mac address='52:54:00:72:1e:a5'/>
      <source bridge='br0'/>
      <model type='virtio-net'/>
    </interface>

    <serial type='pty'>
      <target type='isa-serial' port='0'><model name='isa-serial'/></target>
    </serial>
    <console type='pty'><target type='serial' port='0'/></console>
    <channel type='unix'>
      <target type='virtio' name='org.qemu.guest_agent.0'/>
    </channel>

    <input type='tablet' bus='usb'/>
    <input type='mouse' bus='ps2'/>
    <input type='keyboard' bus='ps2'/>

    <!-- VNC console, reachable from the Unraid VMs tab -->
    <graphics type='vnc' port='-1' autoport='yes' websocket='-1' listen='0.0.0.0' keymap='en-us'>
      <listen type='address' address='0.0.0.0'/>
    </graphics>
    <video>
      <model type='qxl' ram='65536' vram='65536' vgamem='16384' heads='1' primary='yes'/>
    </video>
    <memballoon model='virtio'/>
  </devices>
</domain>
```
