# Pack the EQ client's item icons into ONE atlas for wolfpack.quest + Mimic.
#
#   powershell -ExecutionPolicy Bypass -File scripts\pack-item-icons.ps1 -EqDir "A:\EQ"
#
# Windows-only ON PURPOSE. The earlier bash version was a mistake: the source
# files only exist inside a Windows EQ install, and `bash` on a Windows box
# hands off to WSL, which fails with
#   execvpe(/bin/bash) failed: No such file or directory
# on any machine without a distro installed. This is the shell the job actually
# runs in.
#
# THE LAYOUT IS DETERMINISTIC, WHICH MEANS NO MANIFEST.
# The client stores icons as dragitem<NN>.<ext>, each a 6x6 grid of 40x40 cells,
# numbered from 500:
#     sheet = floor((icon - 500) / 36) + 1
#     cell  = (icon - 500) % 36
# We re-lay them out as one strip 40 icons wide, indexed by (icon - 500):
#     col = (icon - 500) % 40
#     row = [Math]::Floor((icon - 500) / 40)
# so the renderer is two modulos with no lookup table to drift. Verified against
# live rows: Guise of the Deceiver icon 771 -> dragitem08 cell 19; Thick Banded
# Belt 549 -> dragitem02 cell 13.
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

function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

if (-not (Test-Path -LiteralPath $EqDir)) { Fail "EQ folder not found: $EqDir" }

# ImageMagick 7 ships `magick`; 6 ships `montage`/`convert` separately.
$magick = Get-Command magick -ErrorAction SilentlyContinue
if (-not $magick) {
  Fail @"
ImageMagick not found on PATH.
  winget install ImageMagick.ImageMagick
Then close and reopen PowerShell so PATH refreshes, and re-run this.
"@
}

# Report what we found BEFORE doing any work — a wrong folder should say so
# immediately rather than after several minutes of cropping.
$sheets = Get-ChildItem -LiteralPath $EqDir -File |
  Where-Object { $_.Name -match '^dragitem\d+\.(dds|tga|bmp|png)$' } |
  Sort-Object Name
if ($sheets.Count -eq 0) {
  Fail "No dragitem*.dds/.tga/.bmp/.png in $EqDir — is that the EQ install root (the folder with eqgame.exe)?"
}
Write-Host "found $($sheets.Count) icon sheet(s) in $EqDir"
Write-Host ("  formats: " + (($sheets | Group-Object Extension | ForEach-Object { "$($_.Count)x$($_.Name)" }) -join ', '))

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("eqicons-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

try {
  # Explode each sheet into cells named by their ICON ID, so packing is a plain
  # ordered walk with no per-sheet bookkeeping.
  $count = 0
  foreach ($f in $sheets) {
    if ($f.BaseName -notmatch '(\d+)$') { continue }
    $num = [int]$Matches[1]
    if ($num -lt 1) { continue }

    $stage = Join-Path $tmp "stage"
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    & magick $f.FullName -crop "${Cell}x${Cell}" +repage (Join-Path $stage "c_%d.png") 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  ! could not read $($f.Name) — skipping" -ForegroundColor Yellow
      Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
      continue
    }
    foreach ($c in Get-ChildItem -LiteralPath $stage -Filter 'c_*.png') {
      if ($c.BaseName -notmatch 'c_(\d+)$') { continue }
      $cellIdx = [int]$Matches[1]
      $icon = $FirstIcon + (($num - 1) * 36) + $cellIdx
      Move-Item -LiteralPath $c.FullName -Destination (Join-Path $tmp ("icon_{0:D5}.png" -f $icon)) -Force
      $count++
    }
    Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
  }

  Write-Host "extracted $count icons"
  if ($count -eq 0) { Fail "nothing extracted — sheets unreadable, or not the EQ install root" }

  $icons = Get-ChildItem -LiteralPath $tmp -Filter 'icon_*.png'
  $last = ($icons | ForEach-Object { [int]($_.BaseName -replace 'icon_', '') } | Measure-Object -Maximum).Maximum

  # ⚠ Pad gaps. A missing icon MUST still occupy its slot, or every icon after
  # it shifts by one and the atlas silently shows the WRONG art for every
  # subsequent item — which reads as "bad picture", not "broken build", and is
  # brutal to notice after the fact.
  $blank = Join-Path $tmp "blank.png"
  & magick -size "${Cell}x${Cell}" xc:none $blank
  $padded = 0
  for ($i = $FirstIcon; $i -le $last; $i++) {
    $p = Join-Path $tmp ("icon_{0:D5}.png" -f $i)
    if (-not (Test-Path -LiteralPath $p)) { Copy-Item $blank $p; $padded++ }
  }
  if ($padded -gt 0) { Write-Host "padded $padded empty slot(s) to keep positions exact" }

  # Explicit ordered list rather than a glob — montage must lay these out in
  # icon order, and shell glob ordering is not something to trust here.
  $total = $last - $FirstIcon + 1
  $listFile = Join-Path $tmp "order.txt"
  ($FirstIcon..$last | ForEach-Object { '"' + (Join-Path $tmp ("icon_{0:D5}.png" -f $_)) + '"' }) |
    Set-Content -LiteralPath $listFile -Encoding ASCII

  $outPng = Join-Path $OutDir "items.png"
  & magick montage "@$listFile" -tile "${PerRow}x" -geometry "${Cell}x${Cell}+0+0" -background none $outPng
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outPng)) { Fail "montage failed" }

  $rows = [Math]::Ceiling($total / $PerRow)
  $meta = [ordered]@{
    cell = $Cell; perRow = $PerRow; firstIcon = $FirstIcon; lastIcon = $last; rows = $rows
    note = "Deterministic layout: col=(icon-firstIcon)%perRow, row=floor((icon-firstIcon)/perRow). Regenerate with scripts/pack-item-icons.ps1."
  }
  $meta | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutDir "items.meta.json") -Encoding UTF8

  $size = (Get-Item -LiteralPath $outPng).Length
  Write-Host ""
  Write-Host "wrote $outPng" -ForegroundColor Green
  Write-Host ("  $total slots · ${PerRow}x$rows cells · {0:N0} KB" -f ($size / 1KB))
  Write-Host "  icons $FirstIcon..$last"
  Write-Host ""
  Write-Host "Next: git add $OutDir && git commit && push — then the renderer needs no manifest."
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
