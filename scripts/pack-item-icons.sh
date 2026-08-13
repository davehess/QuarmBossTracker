#!/usr/bin/env bash
# Pack the EQ client's item icons into ONE atlas for wolfpack.quest + Mimic.
#
#   bash scripts/pack-item-icons.sh "A:/EQ" web/public/icons
#
# ⚠ NEEDS A LOCAL SESSION — the source files are in the EQ client install and a
# cloud session cannot reach them (docs/STATUS.md carries the ask).
#
# WHY WE PACK OUR OWN instead of pointing at pqdi.cc: hotlinking spends someone
# else's bandwidth and breaks the day they reorganise. They repacked the client
# sheets into their own larger ones; we do our own repack from the same source,
# so nothing we ship depends on their layout.
#
# THE LAYOUT IS DETERMINISTIC, WHICH MEANS NO MANIFEST.
# The client stores icons as dragitem<NN>.dds, each a 6x6 grid of 40x40 cells,
# numbered from 500:
#     sheet = floor((icon - 500) / 36) + 1
#     cell  = (icon - 500) % 36        (col = cell % 6, row = cell / 6)
# We re-lay them out as one strip 40 icons wide, indexed by (icon - 500):
#     col = (icon - 500) % 40
#     row = floor((icon - 500) / 40)
# so the renderer is two modulos and no lookup table to keep in sync. Verified
# against live rows: Guise of the Deceiver icon 771 -> dragitem08 cell 19;
# Thick Banded Belt 549 -> dragitem02 cell 13.
#
# Requires ImageMagick, which reads DDS natively. Writing a DXT decoder by hand
# would be ~300 lines to save one apt-get, and would be untestable in CI here.
#   Windows: winget install ImageMagick.ImageMagick
#   Debian:  sudo apt install imagemagick
set -euo pipefail

EQ_DIR="${1:-}"
OUT_DIR="${2:-web/public/icons}"
CELL=40          # px per icon in the client sheets
PER_ROW=40       # icons per row in OUR atlas
FIRST_ICON=500   # the client's first icon id

if [ -z "$EQ_DIR" ]; then
  echo "usage: bash scripts/pack-item-icons.sh <EQ install dir> [out dir]" >&2
  exit 1
fi
command -v magick >/dev/null 2>&1 || command -v convert >/dev/null 2>&1 || {
  echo "ImageMagick not found — install it first (see the header)." >&2; exit 1; }
IM=$(command -v magick || command -v convert)

shopt -s nullglob nocaseglob
SHEETS=("$EQ_DIR"/dragitem*.dds "$EQ_DIR"/dragitem*.tga)
if [ ${#SHEETS[@]} -eq 0 ]; then
  echo "no dragitem*.dds / *.tga under $EQ_DIR — is that the EQ install root?" >&2
  exit 1
fi
echo "found ${#SHEETS[@]} icon sheet(s)"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT_DIR"

# Explode every sheet into individual cells named by their ICON ID, so the
# packing step below is a plain sort — no per-sheet bookkeeping.
count=0
for f in "${SHEETS[@]}"; do
  base=$(basename "$f"); num=$(echo "$base" | grep -oE '[0-9]+' | head -1)
  num=$((10#$num))
  [ "$num" -ge 1 ] || continue
  "$IM" "$f" -crop ${CELL}x${CELL} +repage "$TMP/s${num}_%d.png" 2>/dev/null || {
    echo "  ! could not read $base — skipping" >&2; continue; }
  for cellfile in "$TMP/s${num}_"*.png; do
    cell=$(basename "$cellfile" .png); cell=${cell#s${num}_}
    icon=$(( FIRST_ICON + (num - 1) * 36 + cell ))
    mv "$cellfile" "$TMP/icon_$(printf '%05d' "$icon").png"
    count=$((count+1))
  done
done
echo "extracted $count icons"
[ "$count" -gt 0 ] || { echo "nothing extracted — wrong folder or unreadable sheets" >&2; exit 1; }

# Fill gaps so position == (icon - FIRST_ICON). A missing icon MUST still occupy
# its slot or every icon after it shifts and the whole atlas silently misaligns
# — the failure would look like "wrong picture", not "broken build".
last=$(ls "$TMP"/icon_*.png | tail -1 | grep -oE '[0-9]+' | tail -1)
last=$((10#$last))
"$IM" -size ${CELL}x${CELL} xc:none "$TMP/blank.png"
for ((i=FIRST_ICON; i<=last; i++)); do
  p="$TMP/icon_$(printf '%05d' "$i").png"
  [ -f "$p" ] || cp "$TMP/blank.png" "$p"
done

"$IM" montage "$TMP"/icon_*.png \
  -tile ${PER_ROW}x -geometry ${CELL}x${CELL}+0+0 -background none \
  "$OUT_DIR/items.png"

TOTAL=$(( last - FIRST_ICON + 1 ))
ROWS=$(( (TOTAL + PER_ROW - 1) / PER_ROW ))
cat > "$OUT_DIR/items.meta.json" <<JSON
{
  "cell": $CELL,
  "perRow": $PER_ROW,
  "firstIcon": $FIRST_ICON,
  "lastIcon": $last,
  "rows": $ROWS,
  "note": "Deterministic layout: col=(icon-firstIcon)%perRow, row=floor((icon-firstIcon)/perRow). Regenerate with scripts/pack-item-icons.sh."
}
JSON

echo "wrote $OUT_DIR/items.png  ($TOTAL slots, ${PER_ROW}x${ROWS} cells)"
ls -la "$OUT_DIR/items.png"
