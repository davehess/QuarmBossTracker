# whats-running.ps1 -- "what Wolf Pack thing is running on this machine?"
#
# Read-only by default. Answers the question you actually have when Mimic says
#   "Read-only mode: parser (localhost:7777) is the active uploader"
# namely: WHICH install is uploading, where does it live, and what starts it?
#
# There are two independent things that can be running:
#   * the STANDALONE parser  -- Parser.bat / start-logsync.ps1, installed into
#     your EQ folder, auto-started by the scheduled task "WolfpackParser".
#     Its dashboard is http://localhost:7777.
#   * MIMIC                  -- the desktop app, which BUNDLES its own copy of
#     the agent and runs it on 7779+ (7777/7778 are deliberately left free so
#     the two can coexist). Its autostart is a registry Run key, not a task.
#
# Only ONE of them uploads: whoever holds the machine-wide uploader lock in
# %TEMP%. The other still parses locally and shows live stats, it just doesn't
# post -- that's the read-only banner, and it is working as designed.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\whats-running.ps1
#   powershell -ExecutionPolicy Bypass -File .\whats-running.ps1 -StopParser
#
#   -StopParser  Retire the standalone parser so Mimic takes over: stops the
#                running process, removes the "WolfpackParser" scheduled task
#                and the Parser shortcuts. Prompts first (-Force skips).
#                Nothing is deleted from your EQ folder, so re-running
#                Parser.bat brings it all back.

param(
    [switch] $StopParser,
    [switch] $Force
)

$ErrorActionPreference = 'Continue'
$TaskName     = 'WolfpackParser'
$ShortcutName = 'Parser.lnk'
$LockFile     = Join-Path $env:TEMP 'wolfpack-logsync-uploader.json'

function Section([string]$t) {
    Write-Host ''
    Write-Host "  $t" -ForegroundColor Cyan
    Write-Host ('  ' + ('-' * $t.Length)) -ForegroundColor DarkGray
}
function Ok([string]$m)   { Write-Host "    $m" -ForegroundColor Green }
function Info([string]$m) { Write-Host "    $m" -ForegroundColor Gray }
function Warn([string]$m) { Write-Host "    $m" -ForegroundColor Yellow }
function Dim([string]$m)  { Write-Host "    $m" -ForegroundColor DarkGray }

Write-Host ''
Write-Host '  Wolf Pack -- what is running here?' -ForegroundColor White
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  on  $env:COMPUTERNAME" -ForegroundColor DarkGray

# --- 1. Who holds the uploader lock ------------------------------------------
# This is the authoritative answer to "who is uploading". Written by whichever
# agent won the election; refreshed every 15s, considered stale after 45s.
Section 'Uploader lock (who is actually posting to Discord/Supabase)'
$lockHolderPid = $null
if (Test-Path $LockFile) {
    try {
        $lock = Get-Content $LockFile -Raw | ConvertFrom-Json
        $lockHolderPid = $lock.pid
        $alive = $null -ne (Get-Process -Id $lock.pid -ErrorAction SilentlyContinue)
        $age   = if ($lock.heartbeatAt) { [int]((Get-Date) - [datetime]$lock.heartbeatAt).TotalSeconds } else { -1 }
        $client = if ($lock.client) { $lock.client } else { 'parser' }
        Ok "holder: $client  (pid $($lock.pid), agent $($lock.agentVersion), dashboard port $($lock.webPort))"
        Info "heartbeat: ${age}s ago   process alive: $alive"
        if (-not $alive)   { Warn 'Lock is STALE (pid is dead) -- the next agent to check will take over within ~15s.' }
        elseif ($age -gt 45) { Warn "Lock is STALE (heartbeat older than 45s) -- another agent may take over." }
        Dim "file: $LockFile"
    } catch { Warn "Lock file exists but could not be parsed: $($_.Exception.Message)" }
} else {
    Info 'No lock file -- nothing is currently claiming the uploader role.'
    Dim "expected at: $LockFile"
}

# --- 2. What is listening on the dashboard ports -----------------------------
Section 'Listening dashboard ports'
$portOwners = @{}
foreach ($port in 7777..7784) {
    try {
        $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) {
            $p = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            $portOwners[$port] = $conn.OwningProcess
            $label = switch ($port) {
                7777 { 'standalone parser (default)' }
                7778 { 'standalone parser (second instance)' }
                default { 'Mimic bundled agent' }
            }
            Ok "$port  <- pid $($conn.OwningProcess)  $($p.ProcessName)   [$label]"
        }
    } catch { }
}
if ($portOwners.Count -eq 0) { Info 'Nothing listening on 7777-7784 -- no agent is running right now.' }

# --- 3. Every Wolf Pack process, with the install path it was launched from ---
# The command line is what tells the two installs apart: the standalone parser
# runs <EQdir>\wolfpack-logsync\index.js; Mimic's agent runs out of its own
# userData\agent folder.
Section 'Running processes (node / Mimic)'
$found = @()
try {
    $procs = Get-CimInstance Win32_Process -ErrorAction Stop |
             Where-Object { $_.CommandLine -match 'wolfpack|logsync|mimic' -or $_.Name -match 'node\.exe' }
    foreach ($pr in $procs) {
        $cl = $pr.CommandLine
        $kind =
            if ($cl -match 'mimic')                        { 'MIMIC' }
            elseif ($cl -match 'wolfpack-logsync\\index\.js') { 'PARSER (agent)' }
            elseif ($cl -match 'start-logsync\.ps1')       { 'PARSER (launcher)' }
            elseif ($cl -match 'supervisor\.js')           { 'PARSER (supervisor)' }
            else { 'node (unrelated?)' }
        $isLockHolder = ($lockHolderPid -and $pr.ProcessId -eq $lockHolderPid)
        $tag = if ($isLockHolder) { '  <== HOLDS THE UPLOADER LOCK' } else { '' }
        $found += [pscustomobject]@{ Pid = $pr.ProcessId; Kind = $kind; Cmd = $cl }
        Write-Host "    [$kind] pid $($pr.ProcessId)$tag" -ForegroundColor $(if ($isLockHolder) { 'Green' } else { 'Gray' })
        # Pull the install directory out of the command line -- this is the
        # "where did this thing come from" answer.
        if ($cl -match '"?([A-Za-z]:\\[^"]*?)\\(wolfpack-logsync\\index\.js|start-logsync\.ps1|supervisor\.js)') {
            Dim "  from: $($Matches[1])"
        }
        Dim "  $($cl -replace '\s+', ' ')"
    }
} catch { Warn "Could not enumerate processes: $($_.Exception.Message)" }
if ($found.Count -eq 0) { Info 'No node.exe / Mimic processes found.' }

# --- 4. Autostart entries -----------------------------------------------------
Section 'Autostart -- standalone parser'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    Warn "Scheduled task '$TaskName' EXISTS  (state: $($task.State))"
    foreach ($a in $task.Actions) { Dim "  runs: $($a.Execute) $($a.Arguments)" }
    if ($info) { Dim "  last run: $($info.LastRunTime)   next: $($info.NextRunTime)" }
    Dim '  -> this is what starts the parser at every login'
} else {
    Ok "No scheduled task '$TaskName' -- the parser does not auto-start."
}
$shortcuts = @(
    @{ P = (Join-Path ([Environment]::GetFolderPath('Desktop'))  $ShortcutName); L = 'Desktop shortcut' },
    @{ P = (Join-Path ([Environment]::GetFolderPath('Programs')) $ShortcutName); L = 'Start menu shortcut' },
    @{ P = (Join-Path ([Environment]::GetFolderPath('Startup'))  $ShortcutName); L = 'Startup-folder shortcut' }
)
foreach ($s in $shortcuts) {
    if (Test-Path $s.P) { Warn "$($s.L): $($s.P)" }
}

Section 'Autostart -- Mimic'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
try {
    $props = Get-ItemProperty -Path $runKey -ErrorAction Stop
    $mimicKeys = $props.PSObject.Properties | Where-Object { $_.Value -match 'mimic' -or $_.Name -match 'mimic' }
    if ($mimicKeys) { foreach ($k in $mimicKeys) { Ok "Run key '$($k.Name)' -> $($k.Value)" } }
    else { Info 'No Mimic Run key -- Mimic does not start with Windows (tray menu: "Start with Windows").' }
    if (($mimicKeys | Measure-Object).Count -gt 1) {
        Warn 'More than one Mimic Run key -- newer builds sweep dupes automatically on launch.'
    }
} catch { Info 'Could not read the Run key.' }

# --- 5. Installed copies on disk ---------------------------------------------
Section 'Installed copies found on disk'
$candidates = @()
foreach ($f in $found) {
    if ($f.Cmd -match '"?([A-Za-z]:\\[^"]*?)\\(wolfpack-logsync\\index\.js|start-logsync\.ps1|supervisor\.js)') {
        $candidates += $Matches[1]
    }
}
# Also probe the usual EQ locations, since a parser that is not running right
# now still has an install (and a config) sitting there.
foreach ($drive in (Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root)) {
    foreach ($sub in @('EverQuest', 'EQ', 'TAKP', 'Games\EverQuest', 'Games\EQ')) {
        $p = Join-Path $drive $sub
        if (Test-Path (Join-Path $p 'start-logsync.ps1')) { $candidates += $p }
    }
}
$candidates = $candidates | Select-Object -Unique
if ($candidates) {
    foreach ($c in $candidates) {
        Info $c
        foreach ($file in @('start-logsync.ps1','Parser.bat','logsync.config.json','wolfpack-logsync\index.js','wolfpack-logsync\logsync.pid.json','logsync.queue.json')) {
            $fp = Join-Path $c $file
            if (Test-Path $fp) {
                $sz = [math]::Round((Get-Item $fp).Length / 1KB, 1)
                $mt = (Get-Item $fp).LastWriteTime.ToString('yyyy-MM-dd HH:mm')
                Dim "  $file   ${sz} KB   modified $mt"
            }
        }
        # A queue with pending items means uploads are waiting -- worth knowing
        # before you stop anything.
        $q = Join-Path $c 'logsync.queue.json'
        if (Test-Path $q) {
            try {
                $items = (Get-Content $q -Raw | ConvertFrom-Json)
                $n = @($items).Count
                if ($n -gt 0) { Warn "  QUEUE HAS $n PENDING UPLOAD(S) -- let it drain before stopping this parser." }
            } catch { }
        }
    }
} else {
    Info 'No standalone parser install found.'
}

# --- 6. Verdict ---------------------------------------------------------------
Section 'Verdict'
$parserRunning = @($found | Where-Object { $_.Kind -like 'PARSER*' }).Count -gt 0
$mimicRunning  = @($found | Where-Object { $_.Kind -eq 'MIMIC' }).Count -gt 0
if ($parserRunning -and $mimicRunning) {
    Warn 'BOTH the standalone parser and Mimic are running.'
    Info 'This is safe -- the uploader lock means only one of them posts, so nothing'
    Info 'is double-counted. But the parser is the one holding the lock, so Mimic sits'
    Info 'in read-only mode and its newer bundled agent is not the one uploading.'
    Info ''
    Info 'To hand the job to Mimic:   .\whats-running.ps1 -StopParser'
} elseif ($parserRunning) {
    Info 'Only the standalone parser is running. Mimic is closed.'
} elseif ($mimicRunning) {
    Ok 'Only Mimic is running -- it holds the uploader lock. Nothing to clean up.'
    if ($task) { Warn "But the '$TaskName' task still exists, so the parser returns at next login. Use -StopParser." }
} else {
    Info 'Neither is running right now.'
}

# --- 7. Optional: retire the standalone parser --------------------------------
if ($StopParser) {
    Section 'Stopping the standalone parser'
    Write-Host '    This will:' -ForegroundColor Yellow
    Write-Host '      1. stop the running parser process (if any)' -ForegroundColor Yellow
    Write-Host "      2. remove the '$TaskName' scheduled task (the autostart)" -ForegroundColor Yellow
    Write-Host '      3. remove the Parser desktop / Start-menu / Startup shortcuts' -ForegroundColor Yellow
    Write-Host '    Your EQ folder files are NOT touched -- running Parser.bat restores everything.' -ForegroundColor DarkGray
    Write-Host ''
    if (-not $Force) {
        $ans = Read-Host '    Proceed? (y/N)'
        if ($ans -notmatch '^(y|yes)$') { Info 'Cancelled -- nothing changed.'; Write-Host ''; exit 0 }
    }

    foreach ($f in ($found | Where-Object { $_.Kind -like 'PARSER*' })) {
        try {
            Stop-Process -Id $f.Pid -Force -ErrorAction Stop
            Ok "Stopped $($f.Kind) pid $($f.Pid)."
        } catch { Warn "Could not stop pid $($f.Pid): $($_.Exception.Message)" }
    }
    if ($task) {
        try {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
            Ok "Removed scheduled task '$TaskName'."
        } catch { Warn "Could not remove the task (try an elevated PowerShell): $($_.Exception.Message)" }
    }
    foreach ($s in $shortcuts) {
        if (Test-Path $s.P) {
            try { Remove-Item $s.P -Force -ErrorAction Stop; Ok "Removed $($s.L)." }
            catch { Warn "Could not remove $($s.L): $($_.Exception.Message)" }
        }
    }
    # The lock is only released cleanly on a graceful exit; after a hard stop it
    # sits there until it goes stale. Clear it so Mimic takes over immediately
    # instead of waiting out the 45s TTL.
    if (Test-Path $LockFile) {
        try {
            $lk = Get-Content $LockFile -Raw | ConvertFrom-Json
            if (-not (Get-Process -Id $lk.pid -ErrorAction SilentlyContinue)) {
                Remove-Item $LockFile -Force
                Ok 'Cleared the stale uploader lock -- Mimic will claim it within ~15s.'
            }
        } catch { }
    }
    Write-Host ''
    Info 'Done. Mimic should drop its read-only banner within about 15 seconds'
    Info '(its bundled agent takes over uploading). Restart Mimic if it lingers.'
}

Write-Host ''
