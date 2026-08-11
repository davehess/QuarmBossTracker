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
- 2 vCPU, **4 GB RAM**, 40 GB vdisk
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
| Port | `3000` |
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

At this point Deploy gives you the public pages. Sign-in needs Part F.

## Part F — Discord sign-in against the LOCAL stack

The sign-in gate (`web/app/auth/callback/route.ts`) does three things: confirms
guild membership via Discord's live API, resolves role IDs through the restored
`wolfpack_roles`, then upserts `wolfpack_members` **`onConflict: 'discord_id'`**.
That last detail is why this works locally at all: the row keys on Discord ID, so
a local GoTrue user with a brand-new `auth.users` UUID still lands on the restored
member row. **No second Discord app and no second Supabase project** — the trap
documented in CLAUDE.md for `b.wolfpack.quest` does not apply, because we are
adding a redirect URI to the SAME Discord app.

### F1 — prerequisite: the Discord client secret

⚠ **Check this BEFORE anything else.** Discord shows a client secret once, at
creation. If it was never saved, the only way to get one is **Reset Secret**,
**which immediately breaks production sign-in** until the cloud project's Discord
provider is updated with the new value. If you must reset: update the cloud
Supabase provider config in the same sitting, and do it outside a raid window.
Look first in the cloud Dashboard → Authentication → Providers → Discord.

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

## Appendix — VM definition (Unraid → VMS → Add VM → XML View)

Generate a FRESH `uuid` and `mac` if you ever build a second one; duplicates
break libvirt. `br0` is the load-bearing line — the default `virbr0` NATs the VM
and makes both Coolify and the site unreachable from your desktop. SeaBIOS rather
than OVMF on purpose: no nvram file to go wrong on a headless server VM.

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

    <!-- Main disk. 40G raw image; Unraid creates it on first start.
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
