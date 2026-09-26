#!/bin/sh
# Tests the tag save/restore rules off-client: extracts the body of sync_saved_tags (the sync_one lambda
# through the entity loop) and handle_entity_destructor verbatim from Zeal/nameplate.cpp, then builds and
# runs sync.cpp. Also re-runs the file round-trip test the same way.
# Usage: sh sync.sh <zeal-checkout>   (run from this folder)
set -e
N="$1/Zeal/nameplate.cpp"
awk '/^  \/\/ One live entity against its saved copy/{p=1} /^  auto too_old/{exit} p{print}' "$N" > sync_body.inc
awk '/^void NamePlate::handle_entity_destructor/{p=1} p{print} p&&/^}/{exit}' "$N" > destructor.inc
g++ -std=c++20 -w -I. -o sync sync.cpp
./sync
awk '/^static constexpr long long kSavedTagMaxAgeSeconds/{print} /^static constexpr int kSavedPlayerZone/{print} /^void NamePlate::load_saved_tags/{f=1} /^void NamePlate::write_saved_tags/{f=1} f{print} f&&/^}/{f=0}' "$N" > extracted.inc
g++ -std=c++20 -w -I. -o roundtrip roundtrip.cpp
./roundtrip
rm -f sync roundtrip sync_body.inc destructor.inc extracted.inc
