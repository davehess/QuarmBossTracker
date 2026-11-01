# raidmimic-discord-setup.ps1 - build the Raid Mimic community Discord in one run (the guild lead, 2026-11-01:
# "please help me set this discord up appropriately"). Run it ONCE on your own PC with the Raid Mimic bot in the server.
#
#   powershell -ExecutionPolicy Bypass -File raidmimic-discord-setup.ps1 -GuildId <server id> [-DryRun]
#
# The bot token is asked for with hidden input and lives only in this PowerShell process: never in a file, the repo,
# chat or Railway. Re-running is safe: every role, category and channel is looked up by name first and only made when
# missing; the welcome posts are only sent into a channel this run created.
#
# What it makes (the layout the guild lead approved on 2026-10-31):
#   roles      Staff, Guild leader, Beta tester, Player (top to bottom; no extra permissions - give Staff yours by hand)
#   Start here     #welcome (read-only, pinned welcome), #link-your-account (read-only); Discord's #rules is moved here
#   Raid Mimic     #announcements, #mimic-releases (announcement channels, read-only), #status (read-only)
#   Help           #install-help, #bug-reports, #ideas (forums: one post per problem)
#   Players        #general, #looking-for-raid, #server-stats (read-only)
#   Guild leaders  #guild-leaders, #billing-help (hidden: Guild leader + Staff only); #moderator-only is moved here
#   onboarding     "What brings you here?" -> Player / Guild leader / Beta tester (if Discord accepts it; else by hand)
#
# The bot needs, for this run only: Manage Roles, Manage Channels, Manage Server, View, Send, Manage Messages, Embed.
# Afterwards remove Manage Channels and Manage Server from its role (Server Settings > Roles > Raid Mimic).
# Pure ASCII on purpose: Windows PowerShell 5.1 misreads a BOM-less UTF-8 .ps1 (test/powershell-ascii.test.js).

param(
  [Parameter(Mandatory = $true)][string]$GuildId,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$sec = Read-Host 'Raid Mimic bot token (input hidden)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
if (-not $Token) { throw 'No token given.' }

$Base = 'https://discord.com/api/v10'
$Headers = @{ Authorization = "Bot $Token"; 'User-Agent' = 'DiscordBot (https://raidmimic.com, 1.0)' }

# Permission bits (strings, as the API wants them)
$VIEW = 1024; $SEND = 2048; $MANAGE_MSG = 8192; $EMBED = 16384; $HISTORY = 65536
$THREADS = 34359738368 + 274877906944   # create public threads + send in threads (forum posts)

function Api([string]$Method, [string]$Path, $Body = $null) {
  for ($try = 0; $try -lt 5; $try++) {
    try {
      $args2 = @{ Method = $Method; Uri = "$Base$Path"; Headers = $Headers }
      if ($null -ne $Body) {
        $args2.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10 -Compress))
        $args2.ContentType = 'application/json'
      }
      return Invoke-RestMethod @args2
    } catch {
      $resp = $_.Exception.Response
      $code = if ($resp) { [int]$resp.StatusCode } else { 0 }
      if ($code -eq 429) {
        $wait = 2
        try { $wait = [double]$resp.Headers['Retry-After'] } catch {}
        Start-Sleep -Milliseconds ([int](($wait + 0.25) * 1000)); continue
      }
      $detail = ''
      try { $sr = New-Object IO.StreamReader($resp.GetResponseStream()); $detail = $sr.ReadToEnd() } catch {}
      throw "$Method $Path failed ($code): $detail"
    }
  }
  throw "$Method $Path kept hitting the rate limit."
}
function Say([string]$s) { Write-Host $s }
function Ow([string]$id, [int]$type, [long]$allow, [long]$deny) {
  @{ id = $id; type = $type; allow = "$allow"; deny = "$deny" }
}

$me = Api GET '/users/@me'
$guild = Api GET "/guilds/$GuildId"
Say "Server: $($guild.name)   Bot: $($me.username)"
if (-not ($guild.features -contains 'COMMUNITY')) {
  Say 'WARNING: Community is not enabled. Announcement and forum channels need it (Server Settings > Enable Community).'
}

# ---- Roles ---------------------------------------------------------------------------------------------
$roles = @(Api GET "/guilds/$GuildId/roles")
function RoleId([string]$name) { ($roles | Where-Object { $_.name -eq $name } | Select-Object -First 1).id }
$want = @(
  @{ name = 'Staff';        color = 0xF0B232; hoist = $true },
  @{ name = 'Guild leader'; color = 0x5865F2; hoist = $true },
  @{ name = 'Beta tester';  color = 0xA970FF; hoist = $false },
  @{ name = 'Player';       color = 0x949BA4; hoist = $false }
)
# A new role lands just above @everyone, so creating top-down leaves them in this order.
foreach ($r in $want) {
  if (RoleId $r.name) { Say "role ok      $($r.name)"; continue }
  if ($DryRun) { Say "role MAKE    $($r.name)"; continue }
  $made = Api POST "/guilds/$GuildId/roles" @{ name = $r.name; color = $r.color; hoist = $r.hoist; mentionable = $false; permissions = '0' }
  $roles += $made; Say "role made    $($r.name)"
}
$rStaff = RoleId 'Staff'; $rLead = RoleId 'Guild leader'; $rBeta = RoleId 'Beta tester'; $rPlayer = RoleId 'Player'

# ---- Overwrites ----------------------------------------------------------------------------------------
$everyone = $GuildId
$botAllow = $VIEW + $SEND + $EMBED + $MANAGE_MSG + $HISTORY
function ReadOnly { @( (Ow $everyone 0 0 ($SEND + $THREADS)), (Ow $me.id 1 $botAllow 0) ) }
function Open     { @( (Ow $me.id 1 $botAllow 0) ) }
function Hidden {
  $o = @( (Ow $everyone 0 0 $VIEW), (Ow $me.id 1 $botAllow 0) )
  if ($rLead)  { $o += (Ow $rLead 0 ($VIEW + $SEND + $HISTORY) 0) }
  if ($rStaff) { $o += (Ow $rStaff 0 ($VIEW + $SEND + $HISTORY) 0) }
  $o
}

# ---- Channels ------------------------------------------------------------------------------------------
$chans = @(Api GET "/guilds/$GuildId/channels")
function Find([string]$name, [int]$type) { $chans | Where-Object { $_.name -eq $name -and ($type -lt 0 -or $_.type -eq $type) } | Select-Object -First 1 }
$created = @{}

function Cat([string]$name, $ow) {
  $c = Find $name 4
  if ($c) { Say "category ok  $name"; return $c.id }
  if ($DryRun) { Say "category MAKE $name"; return $null }
  $c = Api POST "/guilds/$GuildId/channels" @{ name = $name; type = 4; permission_overwrites = @($ow) }
  $script:chans += $c; Say "category made $name"; return $c.id
}
function Chan([string]$name, [int]$type, $parent, [string]$topic, $ow) {
  $c = Find $name -1
  if ($c) { Say "channel ok   #$name"; return $c.id }
  if ($DryRun) { Say "channel MAKE #$name"; return $null }
  $body = @{ name = $name; type = $type; topic = $topic; permission_overwrites = @($ow) }
  if ($parent) { $body.parent_id = $parent }
  $c = Api POST "/guilds/$GuildId/channels" $body
  $script:chans += $c; $script:created[$name] = $c.id; Say "channel made #$name"; return $c.id
}
function MoveInto([string]$name, $parent) {
  $c = Find $name -1
  if (-not $c -or -not $parent -or $c.parent_id -eq $parent) { return }
  if ($DryRun) { Say "channel MOVE #$name"; return }
  # lock_permissions false: Discord's own #rules (read-only) and #moderator-only (mods only) keep their permissions.
  Api PATCH "/channels/$($c.id)" @{ parent_id = $parent; lock_permissions = $false } | Out-Null
  Say "channel moved #$name"
}

$cStart = Cat 'Start here' (Open)
$welcome = Chan 'welcome' 0 $cStart 'What Raid Mimic is, and where to start.' (ReadOnly)
MoveInto 'rules' $cStart
$link = Chan 'link-your-account' 0 $cStart 'Sign in at raidmimic.com with Discord: your roles follow.' (ReadOnly)

$cRm = Cat 'Raid Mimic' (Open)
$ann = Chan 'announcements' 5 $cRm 'News from the Raid Mimic team.' (ReadOnly)
$rel = Chan 'mimic-releases' 5 $cRm 'Every Mimic release, stable and beta.' (ReadOnly)
$stat = Chan 'status' 0 $cRm 'Is anything down right now?' (ReadOnly)

$cHelp = Cat 'Help' (Open)
$inst = Chan 'install-help' 15 $cHelp 'One post per problem. Include a screenshot of the Setup checklist.' (Open)
$bugs = Chan 'bug-reports' 15 $cHelp 'One post per bug: what you did, what you saw, your Mimic version.' (Open)
$ideas = Chan 'ideas' 15 $cHelp 'One post per idea.' (Open)

$cPlay = Cat 'Players' (Open)
$gen = Chan 'general' 0 $cPlay 'Talk raids, overlays and everything Quarm.' (Open)
$lfr = Chan 'looking-for-raid' 0 $cPlay 'Looking for a raid or a guild? Say your class, level and times.' (Open)
$stats = Chan 'server-stats' 0 $cPlay 'Whole-server numbers, never anyone by name.' (ReadOnly)

$cLead = Cat 'Guild leaders' (Hidden)
$gl = Chan 'guild-leaders' 0 $cLead 'For guild leaders and staff.' (Hidden)
$bill = Chan 'billing-help' 0 $cLead 'Questions about Pro for your guild.' (Hidden)
MoveInto 'moderator-only' $cLead

# ---- Welcome posts (only into channels this run made) --------------------------------------------------
function Post([string]$chanName, [string]$text) {
  if (-not $created.ContainsKey($chanName)) { return }
  $m = Api POST "/channels/$($created[$chanName])/messages" @{ content = $text }
  try { Api PUT "/channels/$($created[$chanName])/pins/$($m.id)" | Out-Null } catch { Say "  (could not pin in #$chanName)" }
  Say "posted       #$chanName"
}
if (-not $DryRun) {
  Post 'welcome' ("**Raid Mimic**: free raid overlays for Project Quarm, built from the log EverQuest already writes.`n" +
    "Set it up in about ten minutes: https://raidmimic.com/setup`n" +
    "Stuck? Open a post in <#$inst> with a screenshot of the Setup checklist.")
  Post 'link-your-account' ("Sign in at https://raidmimic.com with Discord to link your account and guild.`n" +
    'Roles here follow from that sign-in.')
}

# ---- Server icon, description and welcome-message channel ----------------------------------------------
if (-not $DryRun) {
  try {
    $png = (Invoke-WebRequest -UseBasicParsing 'https://raidmimic.com/mimic-logo.png').Content
    $patch = @{ description = 'Free raid overlays for Project Quarm. Setup guide: raidmimic.com/setup' }
    if (-not $guild.icon) { $patch.icon = 'data:image/png;base64,' + [Convert]::ToBase64String($png) }
    if ($gen) { $patch.system_channel_id = $gen }
    Api PATCH "/guilds/$GuildId" $patch | Out-Null
    Say 'server       icon, description, join messages in #general'
  } catch { Say "server       could not update: $($_.Exception.Message)" }
}

# ---- Onboarding ----------------------------------------------------------------------------------------
if (-not $DryRun -and $rPlayer -and $rLead -and $rBeta) {
  $rules = (Find 'rules' -1).id
  $defaults = @($welcome, $rules, $ann, $rel, $inst, $bugs, $ideas, $gen, $lfr) | Where-Object { $_ }
  $n = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $prompt = @{
    id = "$n"; type = 0; title = 'What brings you here?'; single_select = $false; required = $true; in_onboarding = $true
    options = @(
      @{ id = "$($n + 1)"; title = 'I play'; description = 'Overlays, setup help and the community.'; role_ids = @($rPlayer); channel_ids = @() },
      @{ id = "$($n + 2)"; title = 'I run a guild'; description = 'Guild leader channels and Pro for your guild.'; role_ids = @($rLead); channel_ids = @() },
      @{ id = "$($n + 3)"; title = 'I want beta builds'; description = 'Try new Mimic versions first.'; role_ids = @($rBeta); channel_ids = @() }
    )
  }
  try {
    Api PUT "/guilds/$GuildId/onboarding" @{ prompts = @($prompt); default_channel_ids = @($defaults); enabled = $true; mode = 0 } | Out-Null
    Say 'onboarding   on: "What brings you here?"'
  } catch {
    Say 'onboarding   NOT set by the API. Set it by hand: Server Settings > Onboarding, one question "What brings you here?"'
    Say '             with I play -> Player, I run a guild -> Guild leader, I want beta builds -> Beta tester.'
    Say "             ($($_.Exception.Message))"
  }
}

Say ''
Say 'Done. Copy these IDs into the chat with Claude (they are not secret):'
Say "  server          $GuildId"
Say "  announcements   $ann"
Say "  mimic-releases  $rel"
Say "  status          $stat"
Say 'Then remove Manage Channels and Manage Server from the Raid Mimic role (Server Settings > Roles).'
$Token = $null
