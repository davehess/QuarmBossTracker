// Host test of the /tag key parser in Zeal/nameplate.cpp, extracted verbatim into extracted.inc along with
// TagArrows::Shape from Zeal/tag_arrows.h. Build with Zeal/tag_shapes.cpp (the guild table).
#include <cassert>
#include <cctype>
#include <cstdio>
#include <set>
#include <string>

#include "tag_shapes.h"
typedef unsigned long DWORD;
typedef DWORD D3DCOLOR;
#define D3DCOLOR_XRGB(r, g, b) ((D3DCOLOR)((0xffu << 24) | (((r)&0xff) << 16) | (((g)&0xff) << 8) | ((b)&0xff)))
#include "extracted.inc"

static std::string Lower(std::string s) {
  for (char &c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

int main() {
  assert(ReadTagKey("^10^Kill") == "10" && ReadTagKey("^1^Kill") == "1" && ReadTagKey("^R^x") == "R");
  assert(ReadTagKey("^12^") == "12" && ReadTagKey("^R1^") == "R" && ReadTagKey("^1") == "1");
  assert(ReadTagKey("^PK^Mine") == "PK" && ReadTagKey("^pa^") == "pa" && ReadTagKey("^P7^") == "P7");
  assert(ReadTagKey("^P^") == "P" && ReadTagKey("^P#^") == "P" && ReadTagKey("^PKx") == "P");
  for (int n = 1; n <= 12; ++n) {
    DWORD c = GetTagArrowColor(std::to_string(n));
    assert(GetTagNumber(c) == n && GetPawGlyph(c) == -1);
    assert(std::string(GetShapeName(c)) == "#" + std::to_string(n));
    assert(static_cast<int>(GetTagShape(c)) == static_cast<int>(TagArrows::Shape::Number1) + n - 1);
  }
  const char *glyphs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (int g = 0; g < 36; ++g) {
    DWORD c = GetTagArrowColor(std::string("P") + glyphs[g]);
    assert(GetPawGlyph(c) == g && GetTagNumber(c) == 0);
    assert(std::string(GetShapeName(c)) == std::string("Paw ") + glyphs[g]);
    if (g >= 10) assert(GetTagArrowColor(std::string("p") + char(glyphs[g] - 'A' + 'a')) == c);
  }
  assert(GetTagArrowColor("P") == TagArrowColor::Paw && GetPawGlyph(TagArrowColor::Paw) == -1);
  assert(GetTagArrowColor("13") == TagArrowColor::Off && GetTagArrowColor("0") == TagArrowColor::Off);
  assert(GetTagArrowColor("K") == TagArrowColor::Skull && GetTagArrowColor("x") == TagArrowColor::Cross);
  assert(GetTagArrowColor("A") == TagArrowColor::Sword && GetTagArrowColor("d") == TagArrowColor::Diamond);
  assert(GetTagArrowColor("F") == TagArrowColor::Flame && GetTagArrowColor("t") == TagArrowColor::Star);
  assert(GetTagArrowColor("WP") == TagArrowColor::Wolf && GetTagArrowColor("wp") == TagArrowColor::Wolf);
  assert(GetTagArrowColor("L") == TagArrowColor::Off && GetTagArrowColor("m") == TagArrowColor::Moon);
  assert(ReadTagKey("^WP^Pack") == "WP" && ReadTagKey("^wP^") == "wP" && ReadTagKey("^W^Pull") == "W");
  assert(ReadTagKey("^WPx^") == "W" && ReadTagKey("^WP") == "W" && GetTagArrowColor("W") == TagArrowColor::White);
  assert(std::string(GetShapeName(TagArrowColor::Wolf)) == "Wolf");
  assert(GetTagArrowColor("U") == TagArrowColor::Lasso && GetTagArrowColor("n") == TagArrowColor::Lute);
  assert(GetTagArrowColor("H") == TagArrowColor::Shield && std::string(GetShapeName(TagArrowColor::Shield)) == "Shield");
  assert(GetTagArrowColor("$") == TagArrowColor::Dollar && GetTagArrowColor("e") == TagArrowColor::Euro);
  assert(ReadTagKey("^$^Loot") == "$");
  assert(GetTagArrowColor("R") == TagArrowColor::Red && GetTagArrowColor("s") == TagArrowColor::StopSign);
  assert(GetTagArrowColor("-") == TagArrowColor::Off && GetTagNumber(TagArrowColor::White) == 0);
  assert(GetShapeName(TagArrowColor::Red) == nullptr && std::string(GetShapeName(TagArrowColor::Moon)) == "Moon");
  assert(GetTagShape(TagArrowColor::Blue) == TagArrows::Shape::Arrow);

  // Guild banners and icons: only a known code after B or I, running to the next '^'.
  assert(ReadTagKey("^BEUR^Europa") == "BEUR" && ReadTagKey("^beur^") == "beur" && ReadTagKey("^IMAY^") == "IMAY");
  assert(ReadTagKey("^Blue^Kill") == "B" && ReadTagKey("^BXYZ^") == "B" && ReadTagKey("^B^") == "B");
  assert(ReadTagKey("^BEUR") == "B" && ReadTagKey("^BC^") == "B" && ReadTagKey("^BBC^") == "BBC");
  assert(ReadTagKey("^BWP^") == "BWP" && ReadTagKey("^IWP^") == "IWP" && ReadTagKey("^IX^") == "I");
  assert(GetTagArrowColor("B") == TagArrowColor::Blue && GetTagArrowColor("I") == TagArrowColor::Off);
  assert(GetTagArrowColor("BLU") == TagArrowColor::Blue);  // Not a guild: still read as B.
  std::set<DWORD> guild_colors;
  for (int i = 0; i < TagShapes::kGuildCount; ++i) {
    const auto &guild = TagShapes::kGuilds[i];
    const std::string code = guild.code;
    assert(TagShapes::GuildIndex(code) == i && TagShapes::GuildIndex(Lower(code)) == i);
    assert(ReadTagKey("^B" + code + "^text") == "B" + code && ReadTagKey("^i" + Lower(code) + "^") == "i" + Lower(code));

    const DWORD banner = GetTagArrowColor("B" + code);
    assert(banner == GetTagArrowColor("b" + Lower(code)) && GetGuildBanner(banner) == i);
    assert(std::string(GetShapeName(banner)) == "Banner " + code);
    assert(static_cast<int>(GetTagShape(banner)) == static_cast<int>(TagArrows::Shape::Banner0) + i);
    assert(guild_colors.insert(banner).second);

    const DWORD icon = GetTagArrowColor("I" + code);
    assert(icon == GetTagArrowColor("i" + Lower(code)));
    if (guild.icon_key) {  // An existing shape stands in: same color, same shape, same name.
      assert(icon == GetTagArrowColor(guild.icon_key) && GetGuildIcon(icon) == -1);
      assert(GetTagShape(icon) != TagArrows::Shape::Arrow && GetShapeName(icon) != nullptr);
    } else {
      assert(GetGuildIcon(icon) == i && std::string(GetShapeName(icon)) == "Icon " + code);
      assert(static_cast<int>(GetTagShape(icon)) == static_cast<int>(TagArrows::Shape::GuildIcon0) + i);
      assert(guild_colors.insert(icon).second);
    }
  }
  assert(GetTagShape(GetTagArrowColor("IWP")) == TagArrows::Shape::Wolf);
  assert(GetTagShape(GetTagArrowColor("IEUR")) == TagArrows::Shape::Euro);
  assert(GetTagShape(GetTagArrowColor("ILSF")) == TagArrows::Shape::Dollar);

  // Every color is distinct from every other: named, numbered, paw-glyph, and guild banner and icon.
  const DWORD named[] = {TagArrowColor::Paw,    TagArrowColor::StopSign, TagArrowColor::Skull,  TagArrowColor::Cross,
                         TagArrowColor::Sword,  TagArrowColor::Diamond,  TagArrowColor::Flame,  TagArrowColor::Star,
                         TagArrowColor::Wolf,   TagArrowColor::Moon,     TagArrowColor::Lasso,  TagArrowColor::Lute,
                         TagArrowColor::Shield, TagArrowColor::Dollar,   TagArrowColor::Euro,   TagArrowColor::Red,
                         TagArrowColor::Orange, TagArrowColor::Yellow,   TagArrowColor::Green,  TagArrowColor::Blue,
                         TagArrowColor::White};
  std::set<DWORD> all(guild_colors);
  for (DWORD c : named) {
    assert(GetTagNumber(c) == 0 && GetPawGlyph(c) == -1 && GetGuildBanner(c) == -1 && GetGuildIcon(c) == -1);
    assert(all.insert(c).second);
  }
  for (int n = 1; n <= 12; ++n) assert(all.insert(GetNumberColor(n)).second);
  for (int g = 0; g < 36; ++g) assert(all.insert(kPawGlyphColorBase + g).second);
  std::printf("keys ok (%zu distinct tag colors)\n", all.size());
}
