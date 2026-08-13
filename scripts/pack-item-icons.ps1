# Pack the EQ client's item icons into ONE atlas for wolfpack.quest + Mimic.
#
#   powershell -ExecutionPolicy Bypass -File scripts\pack-item-icons.ps1 -EqDir "A:\EQ"
#
# ============================ ASCII ONLY. NO EXCEPTIONS. ======================
# Windows PowerShell 5.1 reads a .ps1 as the system ANSI codepage unless the
# file carries a UTF-8 BOM. A single em-dash in a comment therefore arrives as
# the three bytes "a-hat, euro, quote" - and that stray quote character ends the
# nearest string, which cascades into "missing terminator" and "unexpected }"
# errors pointing at lines nowhere near the real problem. The first version of
# this script had nine non-ASCII characters and would not parse at all.
# Use -, ->, and (!) instead of typographic dashes, arrows and warning signs.
# =============================================================================
#
# Windows-only on purpose: the source files only exist inside a Windows EQ
# install, and `bash` on Windows hands off to WSL (which fails outright on a box
# with no distro installed).
#
# THE LAYOUT IS DETERMINISTIC, SO THERE IS NO MANIFEST.
# The client stores icons as dragitem<NN>.<ext>, each a 6x6 grid of 40x40 cells,
# numbered from 500:
#     sheet = floor((icon - 500) / 36) + 1
#     cell  = (icon - 500) % 36
# We re-lay them out as one strip 40 icons wide, indexed by (icon - 500):
#     col = (icon - 500) % 40
#     row = floor((icon - 500) / 40)
# so the renderer is two modulos with no lookup table to drift out of sync with
# the catalog. Verified against live rows: Guise of the Deceiver icon 771 is
# dragitem08 cell 19; Thick Banded Belt 549 is dragitem02 cell 13.
#
# Needs ImageMagick (it decodes DDS/TGA natively; .NET does not):
#   winget install ImageMagick.ImageMagick
# Reopen the terminal afterwards so PATH refreshes.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$EqDir,
  [string]$OutDir = "web\public\icons",
  [int]$Cell = 40,        # px per icon in the client sheets
  [int]$PerRow = 40,      # icons per row in OUR atlas
  [int]$FirstIcon = 500   # the client's first icon id
)

$ErrorActionPreference = 'Stop'

function Fail([string]$msg) {
  Write-Host ("ERROR: " + $msg) -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath $EqDir)) { Fail ("EQ folder not found: " + $EqDir) }

if (-not (Get-Command magick -ErrorAction SilentlyContinue)) {
  Write-Host "ERROR: ImageMagick not found on PATH." -ForegroundColor Red
  Write-Host "  winget install ImageMagick.ImageMagick"
  Write-Host "  ...then close and REOPEN PowerShell so PATH refreshes, and re-run."
  exit 1
}

# Find the sheets. They are NOT in the EQ root on a Titanium-era client - they
# live under uifiles\<skin>\, and a custom skin (NillipussUI etc.) may ship its
# own partial copy alongside the stock set. So: search RECURSIVELY, group by
# folder, and prefer the folder that looks stock and complete.
# Searching only $EqDir was the first version's mistake and produced a confident
# "is that the EQ install root?" on a perfectly correct EQ install root.
Write-Host ("searching " + $EqDir + " for dragitem sheets ...")
$all = Get-ChildItem -LiteralPath $EqDir -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^dragitem\d+\.(dds|tga|bmp|png)$' }

if (-not $all -or $all.Count -eq 0) {
  Write-Host "ERROR: no dragitem*.dds/.tga/.bmp/.png found anywhere under this folder." -ForegroundColor Red
  Write-Host "  Checked recursively, so this is not a subfolder problem."
  Write-Host "  If your client keeps them inside .s3d archives they must be extracted first."
  Write-Host "  To see what IS there:  dir /s /b `"$EqDir\dragitem*`""
  exit 1
}

# Group by folder and pick: stock 'uifiles\default' if present, else whichever
# folder has the most sheets (a custom skin overriding a handful of icons must
# never beat the complete set).
$byDir = $all | Group-Object DirectoryName
$pick = $byDir | Where-Object { $_.Name -match '(?i)uifiles\\default$' } | Select-Object -First 1
if (-not $pick) { $pick = $byDir | Sort-Object { $_.Count } -Descending | Select-Object -First 1 }

if ($byDir.Count -gt 1) {
  Write-Host ("  found sheets in " + $byDir.Count + " folder(s):")
  foreach ($g in ($byDir | Sort-Object { $_.Count } -Descending)) {
    $mark = if ($g.Name -eq $pick.Name) { " <- using" } else { "" }
    Write-Host ("    " + $g.Count + " in " + $g.Name + $mark)
  }
}

$sheets = $pick.Group | Sort-Object Name
Write-Host ("found " + $sheets.Count + " icon sheet(s) in " + $pick.Name)
$fmts = ($sheets | Group-Object Extension | ForEach-Object { [string]$_.Count + "x" + $_.Name }) -join ', '
Write-Host ("  formats: " + $fmts)

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("eqicons-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$cropArg = [string]$Cell + "x" + [string]$Cell
$geomArg = [string]$Cell + "x" + [string]$Cell + "+0+0"
$tileArg = [string]$PerRow + "x"

try {
  # Explode each sheet into cells named by their ICON ID, zero-padded, so the
  # packing step is a plain lexicographic glob - see the montage note below.
  $count = 0
  foreach ($f in $sheets) {
    if ($f.BaseName -notmatch '(\d+)$') { continue }
    $num = [int]$Matches[1]
    if ($num -lt 1) { continue }

    $stage = Join-Path $tmp "stage"
    if (Test-Path -LiteralPath $stage) { Remove-Item -Recurse -Force $stage }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null

    $pattern = Join-Path $stage "c_%d.png"
    & magick $f.FullName -crop $cropArg +repage $pattern 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Host ("  ! could not read " + $f.Name + " - skipping") -ForegroundColor Yellow
      continue
    }

    foreach ($c in (Get-ChildItem -LiteralPath $stage -Filter 'c_*.png')) {
      if ($c.BaseName -notmatch 'c_(\d+)$') { continue }
      $cellIdx = [int]$Matches[1]
      $icon = $FirstIcon + (($num - 1) * 36) + $cellIdx
      $dest = Join-Path $tmp ("icon_{0:D5}.png" -f $icon)
      Move-Item -LiteralPath $c.FullName -Destination $dest -Force
      $count = $count + 1
    }
    Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
  }

  Write-Host ("extracted " + $count + " icons")
  if ($count -eq 0) { Fail "nothing extracted - sheets unreadable, or not the EQ install root" }

  $nums = Get-ChildItem -LiteralPath $tmp -Filter 'icon_*.png' | ForEach-Object {
    [int]($_.BaseName -replace 'icon_', '')
  }
  $last = ($nums | Measure-Object -Maximum).Maximum

  # (!) Pad gaps. A missing icon MUST still occupy its slot, or every icon after
  # it shifts by one and the atlas silently shows the WRONG art for every
  # subsequent item - which reads as "bad picture", not "broken build", and is
  # brutal to notice after the fact.
  $blank = Join-Path $tmp "blank.png"
  & magick -size $cropArg 'xc:none' $blank
  if ($LASTEXITCODE -ne 0) { Fail "could not create the blank padding cell" }

  $padded = 0
  for ($i = $FirstIcon; $i -le $last; $i++) {
    $p = Join-Path $tmp ("icon_{0:D5}.png" -f $i)
    if (-not (Test-Path -LiteralPath $p)) {
      Copy-Item -LiteralPath $blank -Destination $p
      $padded = $padded + 1
    }
  }
  if ($padded -gt 0) { Write-Host ("padded " + $padded + " empty slot(s) to keep positions exact") }
  Remove-Item -LiteralPath $blank -Force

  # Ordering comes from the zero-padded names: icon_00500 .. icon_02000 sorts
  # lexicographically the same as numerically, so a plain glob is correct.
  # Deliberately NOT ImageMagick's @listfile indirection - IM7 blocks indirect
  # file reads by default, so that path fails on a stock install.
  $total = $last - $FirstIcon + 1
  $glob = Join-Path $tmp "icon_*.png"
  $outPng = Join-Path $OutDir "items.png"
  Write-Host ("packing " + $total + " slots ...")
  & magick montage $glob -tile $tileArg -geometry $geomArg -background none $outPng
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outPng)) { Fail "montage failed" }

  $rows = [Math]::Ceiling($total / $PerRow)
  $meta = [ordered]@{
    cell      = $Cell
    perRow    = $PerRow
    firstIcon = $FirstIcon
    lastIcon  = $last
    rows      = $rows
    note      = "Deterministic layout: col=(icon-firstIcon)%perRow, row=floor((icon-firstIcon)/perRow). Regenerate with scripts/pack-item-icons.ps1."
  }
  $meta | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutDir "items.meta.json") -Encoding UTF8

  $sizeKb = [Math]::Round((Get-Item -LiteralPath $outPng).Length / 1KB)
  Write-Host ""
  Write-Host ("wrote " + $outPng) -ForegroundColor Green
  Write-Host ("  " + $total + " slots, " + $PerRow + "x" + $rows + " cells, " + $sizeKb + " KB")
  Write-Host ("  icons " + $FirstIcon + ".." + $last)
  Write-Host ""
  Write-Host "Next: commit web/public/icons/ and the renderer needs no manifest."
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
