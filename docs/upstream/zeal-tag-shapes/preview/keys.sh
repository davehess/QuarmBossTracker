#!/bin/sh
# Tests the /tag key parser off-client: extracts it verbatim from Zeal/nameplate.cpp (plus TagArrows::Shape
# from Zeal/tag_arrows.h) into extracted.inc, then builds and runs keys.cpp against Zeal/tag_shapes.cpp.
# Usage: sh keys.sh <zeal-checkout>   (run from this folder)
set -e
ZEAL="$1"
N="$ZEAL/Zeal/nameplate.cpp"
{
  echo "struct TagArrows {"
  awk '/^  enum class Shape \{/{p=1} p{print} p&&/^  \};/{exit}' "$ZEAL/Zeal/tag_arrows.h"
  echo "};"
  awk '/^enum TagArrowColor/{p=1} p{print} p&&/^};/{exit}' "$N"
  awk '/^static constexpr DWORD kNumberColorBase/{p=1} /^static float z_position_offset/{exit} p{print}' "$N"
  awk '/^\/\/ Returns the guild index of a `kind`/{p=1} p{print} p&&/^};/{exit}' "$N"
} > extracted.inc
g++ -std=c++20 -w -I"$ZEAL/Zeal" -o keys keys.cpp "$ZEAL/Zeal/tag_shapes.cpp"
./keys
