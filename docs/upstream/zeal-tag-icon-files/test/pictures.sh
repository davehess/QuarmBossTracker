#!/bin/sh
# Tests the tag-picture logic off-client: the /tag key parser and folder scan from Zeal/nameplate.cpp, and
# the file-header check from Zeal/tag_arrows.cpp, extracted verbatim into extracted.inc. Needs g++ only.
# Usage: sh pictures.sh <zeal-checkout>   (run from this folder)
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
  awk '/^static bool ReadImageSize/{p=1} p{print} p&&/^}/{exit}' "$ZEAL/Zeal/tag_arrows.cpp"
} > extracted.inc
g++ -std=c++20 -w -I"$ZEAL/Zeal" -o pictures pictures.cpp "$ZEAL/Zeal/tag_shapes.cpp"
./pictures
